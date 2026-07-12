import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./design/tokens.css";   // tokens first: later sheets consume them
import "./styles.css";
import "./shell.css";
import "./ux.css";
import "./workspace/workspace.css"; // after shell: the workspace overrides page chrome
import "./shots/shots.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
