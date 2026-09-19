import { Hono } from "hono";

export { TransactionTracker } from "./workflows/transaction-tracker";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
