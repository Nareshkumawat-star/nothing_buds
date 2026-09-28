import * as React from "react";

/* React 18's DOM types predate the standardised `inert` attribute.
   glyph-portal.tsx uses it declaratively, so teach the types about it.
   (React 18 renders unknown boolean attributes as inert="true"/"false".) */
declare module "react" {
  interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    inert?: boolean;
  }
}
