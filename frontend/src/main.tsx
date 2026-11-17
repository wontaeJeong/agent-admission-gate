import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { DirtyFormsProvider } from "./DirtyForms";
import App from "./App";
import "./styles.css";
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <DirtyFormsProvider>
        <App />
      </DirtyFormsProvider>
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
