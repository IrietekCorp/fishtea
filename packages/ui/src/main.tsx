import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Container } from "./container";
createRoot(document.getElementById("root")!).render(<React.StrictMode><Container /></React.StrictMode>);
