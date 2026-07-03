import React from "react";
import ReactDOM from "react-dom/client";
import { ShowcaseStage } from "./ui/ShowcaseStage";
import "./styles.css";
import "./showcase.css";
import "./site.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <main className="site-shell" aria-label="jiko official site study">
      <section className="site-frame" aria-label="jiko first view">
        <div className="site-hero-copy">
          <h1>
            Meet <span className="site-brand-word">jiko</span>
            <br />
            AI signal instrument
            <br />
            that knows where signals split.
            <br />
            <span className="site-hero-serif">And actually shows them.</span>
          </h1>
        </div>
        <div className="site-hardware-stage" aria-label="jiko hardware">
          <ShowcaseStage surface="embedded" />
        </div>
      </section>
    </main>
  </React.StrictMode>,
);
