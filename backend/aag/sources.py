import asyncio
import hashlib
import ipaddress
import os
import signal
import socket
import stat
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


class SourceError(ValueError):
    pass


def validate_git_url(url, allowed_hosts, resolve=True):
    p = urlsplit(url)
    if (
        p.scheme != "https"
        or not p.hostname
        or p.hostname not in allowed_hosts
        or p.username
        or p.password
        or p.query
        or p.fragment
        or p.port not in (None, 443)
    ):
        raise SourceError(
            "Use an HTTPS repository on an approved host, without credentials or query parameters"
        )
    pieces = p.path.strip("/").removesuffix(".git").split("/")
    if len(pieces) < 2 or any(
        not x or x in {".", ".."} or not all(c.isalnum() or c in "._-" for c in x) for x in pieces
    ):
        raise SourceError("Invalid repository path")
    if resolve:
        try:
            addresses = socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM)
        except OSError as e:
            raise SourceError("Repository host could not be resolved") from e
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise SourceError("Repository host resolves to a non-public address")
    return "https://" + p.hostname + "/" + "/".join(pieces) + ".git"


def safe_files(root, settings):
    files, size = [], 0
    for path in root.rglob("*"):
        if ".git" in path.relative_to(root).parts:
            continue
        if path.is_symlink():
            raise SourceError("Symlinks are not accepted")
        if path.is_file():
            files.append(path)
            size += path.stat().st_size
            if len(files) > settings.max_files or size > settings.max_extracted_bytes:
                raise SourceError("Repository exceeds file or size limits")
    return sorted(files)


def extract_zip(data, root, settings):
    import io

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            total = 0
            entries = archive.infolist()
            if len(entries) > settings.max_files:
                raise SourceError("Too many archive entries")
            seen = set()
            for item in entries:
                name = item.filename
                parts = PurePosixPath(name).parts
                mode = item.external_attr >> 16
                if (
                    name.startswith("/")
                    or "\\" in name
                    or not parts
                    or any(p in {"..", ".git"} or ":" in p for p in parts)
                    or stat.S_ISLNK(mode)
                    or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))
                ):
                    raise SourceError("Unsafe archive path or file type")
                dest = root.joinpath(*parts)
                if dest in seen:
                    raise SourceError("Duplicate archive path")
                seen.add(dest)
                total += item.file_size
                if total > settings.max_extracted_bytes or item.flag_bits & 1:
                    raise SourceError("Archive exceeds limits or is encrypted")
                if item.is_dir():
                    dest.mkdir(parents=True, exist_ok=True)
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(item) as source, dest.open("wb") as target:
                        remaining = item.file_size
                        while chunk := source.read(min(65536, remaining + 1)):
                            remaining -= len(chunk)
                            if remaining < 0:
                                raise SourceError("Archive size mismatch")
                            target.write(chunk)
    except (zipfile.BadZipFile, RuntimeError, OSError) as e:
        raise SourceError("Invalid ZIP archive") from e
    return safe_files(root, settings)


async def command(argv, *, cwd, timeout, env=None, max_output=4_000_000, max_disk=None):
    # No shell; child receives no application secrets or ambient cloud credentials.
    clean = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(cwd),
        "LANG": "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_LFS_SKIP_SMUDGE": "1",
    }
    clean.update(env or {})
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        env=clean,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )

    async def read(stream):
        buf = bytearray()
        while chunk := await stream.read(65536):
            buf.extend(chunk)
            if len(buf) > max_output:
                raise SourceError("Command output exceeded limit")
        return bytes(buf)

    async def monitor():
        while proc.returncode is None:
            if max_disk:
                size = sum(
                    p.stat().st_size
                    for p in Path(cwd).rglob("*")
                    if p.is_file() and not p.is_symlink()
                )
                if size > max_disk:
                    raise SourceError("Checkout exceeds disk limit")
            await asyncio.sleep(0.2)

    watcher = asyncio.create_task(monitor())
    capture = asyncio.gather(read(proc.stdout), read(proc.stderr), proc.wait())
    try:
        async with asyncio.timeout(timeout):
            done, _ = await asyncio.wait([capture, watcher], return_when=asyncio.FIRST_COMPLETED)
            if watcher in done and watcher.exception():
                raise watcher.exception()
            output, error, code = await capture
        return code, output.decode(errors="replace"), error.decode(errors="replace")
    finally:
        if proc.returncode is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await proc.wait()
        watcher.cancel()
        capture.cancel()
        await asyncio.gather(watcher, capture, return_exceptions=True)


async def clone(url, ref, credential, root, settings):
    import base64

    url = await asyncio.to_thread(validate_git_url, url, settings.allowed_git_hosts)
    env = {}
    if credential:
        auth = base64.b64encode(("x-access-token:" + credential).encode()).decode()
        env.update(
            GIT_CONFIG_COUNT="1",
            GIT_CONFIG_KEY_0="http.extraHeader",
            GIT_CONFIG_VALUE_0="Authorization: Basic " + auth,
        )
    args = [
        "git",
        "-c",
        "http.followRedirects=false",
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--depth=1",
        "--no-recurse-submodules",
        "--no-local",
    ]
    if ref:
        args += ["--branch", ref]
    args += ["--", url, str(root / "source")]
    code, _, _ = await command(
        args,
        cwd=root,
        timeout=settings.scan_timeout,
        env=env,
        max_disk=settings.max_extracted_bytes,
    )
    env.clear()
    if code:
        raise SourceError("Repository checkout failed; verify URL, ref and access credential")
    checkout = root / "source"
    _, revision, _ = await command(["git", "rev-parse", "HEAD"], cwd=checkout, timeout=10)
    return checkout, safe_files(checkout, settings), revision.strip()


def content_hash(files, root):
    h = hashlib.sha256()
    for path in files:
        h.update(str(path.relative_to(root)).encode() + b"\0")
        with path.open("rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        h.update(b"\0")
    return h.hexdigest()
