import React from "react";
import ReactDOM from "react-dom/client";
import { DevicePreview } from "./ui/DevicePreview";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DevicePreview />
  </React.StrictMode>,
);
