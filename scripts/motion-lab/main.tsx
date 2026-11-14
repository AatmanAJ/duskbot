import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/app.css";
import "./shell/lab.css";
import { startLabClock } from "./shell/clock";
import { App } from "./shell/App";

startLabClock();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
