import { redirect } from "next/navigation";

// Documents were merged into the Import tab; keep this route as a redirect so
// old links and bookmarks still land somewhere sensible.
export default function DocumentsRedirect() {
  redirect("/import");
}
