import React from "react";
import ReactDOM from "react-dom/client";
import { DeviceDemo } from "./ui/DeviceDemo";
import "./styles.css";
import "./demo.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DeviceDemo />
  </React.StrictMode>,
);
