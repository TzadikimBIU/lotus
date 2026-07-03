# Lotus JavaScript Graph Showcase

Run these `obsidian-js` blocks in Obsidian after enabling local execution. Each block emits declarative display MIME data; Lotus renders it with the matching trusted JavaScript graph adapter.

## D3 and Plotly

```obsidian-js
display.d3({
  kind: "bar",
  data: [
    { label: "parse", value: 7 },
    { label: "execute", value: 13 },
    { label: "display", value: 10 }
  ]
}, { title: "Lotus D3 chart", width: 680, height: 320 });

display.plotly({
  data: [
    { x: [1, 2, 3, 4], y: [2, 4, 3, 7], type: "scatter", mode: "lines+markers", name: "runs" }
  ],
  layout: { margin: { t: 24, r: 24, b: 36, l: 42 }, xaxis: { title: "step" }, yaxis: { title: "value" } },
  config: { responsive: true, displaylogo: false }
}, { title: "Lotus Plotly figure", width: 720, height: 360 });
```

## JSXGraph

```obsidian-js
display.jsxgraph({
  boundingbox: [-5, 5, 5, -5],
  axis: true,
  objects: [
    { type: "point", args: [1, 2], attributes: { name: "A", size: 4 } },
    { type: "point", args: [-2, -1], attributes: { name: "B", size: 4 } },
    { type: "line", args: ["A", "B"], attributes: { strokeWidth: 2 } },
    { type: "circle", args: [[0, 0], 2] }
  ]
}, { title: "Lotus JSXGraph board", width: 520, height: 420 });
```

## ELK and Cytoscape.js

```obsidian-js
const elkGraph = {
  graph: {
    id: "root",
    children: [
      { id: "source", width: 96, height: 44, labels: [{ text: "source" }] },
      { id: "runner", width: 96, height: 44, labels: [{ text: "runner" }] },
      { id: "display", width: 96, height: 44, labels: [{ text: "display" }] }
    ],
    edges: [
      { id: "e1", sources: ["source"], targets: ["runner"] },
      { id: "e2", sources: ["runner"], targets: ["display"] }
    ]
  },
  layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT" }
};

display.elk(elkGraph, { title: "Lotus ELK graph", width: 720, height: 360 });

display.cytoscape({
  elements: [
    { data: { id: "note", label: "note" } },
    { data: { id: "mime", label: "MIME" } },
    { data: { id: "adapter", label: "adapter" } },
    { data: { id: "view", label: "view" } },
    { data: { id: "a", source: "note", target: "mime" } },
    { data: { id: "b", source: "mime", target: "adapter" } },
    { data: { id: "c", source: "adapter", target: "view" } }
  ],
  layout: { name: "grid", rows: 1 }
}, { title: "Lotus Cytoscape.js graph", width: 720, height: 320 });
```

## d3-hwschematic

```obsidian-js
display.hwschematic({
  graph: {
    id: "top",
    width: 420,
    height: 180,
    hwMeta: { name: "lotus_top", cls: "module" },
    children: [
      {
        id: "producer",
        width: 110,
        height: 54,
        x: 40,
        y: 54,
        hwMeta: { name: "producer", cls: "display()" },
        ports: [{ id: "producer.out", width: 6, height: 6, properties: { "org.eclipse.elk.port.side": "EAST" } }]
      },
      {
        id: "adapter",
        width: 120,
        height: 54,
        x: 240,
        y: 54,
        hwMeta: { name: "adapter", cls: "renderer" },
        ports: [{ id: "adapter.in", width: 6, height: 6, properties: { "org.eclipse.elk.port.side": "WEST" } }]
      }
    ],
    edges: [{ id: "wire", sources: ["producer.out"], targets: ["adapter.in"] }]
  }
}, { title: "Lotus d3-hwschematic", width: 760, height: 360 });
```
