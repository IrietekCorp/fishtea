import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Container } from "./container";
import { shell as Shell, views } from "#generated/plugins.generated";

/** The application's shell when a shell plugin gives it one; the framework's container otherwise. */
createRoot(document.getElementById("root")!).render(<React.StrictMode>{Shell ? <Shell views={views} /> : <Container />}</React.StrictMode>);
