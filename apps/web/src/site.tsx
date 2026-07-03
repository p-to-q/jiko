import React from "react";
import ReactDOM from "react-dom/client";
import { ShowcaseStage } from "./ui/ShowcaseStage";
import "./styles.css";
import "./showcase.css";
import "./site.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <main className="site-shell" aria-label="jiko official site study">
      <section className="site-frame" aria-label="jiko hardware">
        <ShowcaseStage surface="embedded" />
      </section>
    </main>
  </React.StrictMode>,
);
