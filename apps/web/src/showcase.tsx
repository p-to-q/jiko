import React from "react";
import ReactDOM from "react-dom/client";
import { ShowcaseStage } from "./ui/ShowcaseStage";
import "./styles.css";
import "./showcase.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ShowcaseStage />
  </React.StrictMode>,
);
