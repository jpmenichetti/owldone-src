import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTodos from "./tools/list-todos";
import createTodo from "./tools/create-todo";
import completeTodo from "./tools/complete-todo";
import listWorkspaces from "./tools/list-workspaces";

// Construct the Supabase OAuth issuer from the project ref. Do NOT use
// SUPABASE_URL — on Lovable Cloud it's a proxy host that doesn't match the
// issuer published in the OAuth discovery document.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "owldone-mcp",
  title: "OwlDone",
  version: "0.1.0",
  instructions:
    "Tools for OwlDone, a personal task manager. Use `list_workspaces` to discover workspaces, `list_todos` to read active tasks (optionally filtered by category or workspace), `create_todo` to add new tasks, and `complete_todo` to mark tasks done. Categories are: today, this_week, next_week, others.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listWorkspaces, listTodos, createTodo, completeTodo],
});
