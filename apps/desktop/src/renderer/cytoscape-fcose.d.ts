// cytoscape-fcose ships no types. It's a Cytoscape extension (a function passed to
// cytoscape.use). We only need the default export's type to register it.
declare module "cytoscape-fcose" {
  import type cytoscape from "cytoscape";
  const fcose: cytoscape.Ext;
  export default fcose;
}
