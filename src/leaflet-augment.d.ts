import 'leaflet';

declare module 'leaflet' {
  interface MapOptions {
    center?: LatLngExpression;
    zoom?: number;
  }

  interface TileLayerOptions {
    attribution?: string;
  }

  interface CircleMarkerOptions {
    radius?: number;
  }
}
