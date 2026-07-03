declare module "elkjs/lib/elk.bundled.js" {
  import ElkConstructor from "elkjs/lib/main";

  export default ElkConstructor;
}

declare module "plotly.js-dist-min" {
  interface PlotlyBundle {
    newPlot(graphDiv: HTMLElement, figure: unknown): Promise<unknown>;
    purge?: (graphDiv: HTMLElement) => void;
    Plots?: {
      resize?: (graphDiv: HTMLElement) => void;
    };
  }

  const Plotly: PlotlyBundle;
  export default Plotly;
}
