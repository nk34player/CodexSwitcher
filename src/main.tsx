import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const preventContextMenu = (event: MouseEvent) => {
  event.preventDefault();
};

const preventDevtoolsShortcuts = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase();
  const blocksInspectShortcut =
    key === "f12" ||
    ((event.ctrlKey || event.metaKey) && event.altKey && key === "i") ||
    (event.ctrlKey && event.shiftKey && key === "i") ||
    ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "c") ||
    ((event.ctrlKey || event.metaKey) && key === "u");

  if (blocksInspectShortcut) {
    event.preventDefault();
  }
};

window.addEventListener("contextmenu", preventContextMenu);
window.addEventListener("keydown", preventDevtoolsShortcuts);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
