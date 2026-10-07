import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Container } from "./container";
import { Admin } from "./admin/Admin";
import { ConsentBanner } from "./consent";
import { chrome, shell as Shell, views } from "#generated/plugins.generated";

/**
 * /admin is the operators' console, whatever the application wears; everywhere else is its shell when a
 * shell plugin gives it one, and the framework's container otherwise. The consent banner sits over any of
 * them when the site declares analytics (it stays away from /admin on its own).
 */
const admin = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{admin ? <Admin /> : Shell ? <Shell views={views} chrome={chrome} /> : <Container />}<ConsentBanner /></React.StrictMode>,
);
