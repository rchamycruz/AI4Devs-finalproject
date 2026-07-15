import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonToggleChange, MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import * as L from 'leaflet';
import 'leaflet.markercluster';
import { environment } from '../../../environments/environment';
import { GeoFilters, TATTOO_STYLES } from '../../core/models/artist-filter.models';
import { ArtistCard } from '../../core/models/showcase.models';
import { ArtistCardComponent } from '../../shared/components/artist-card/artist-card.component';
import { FilterPanelComponent } from '../artists/components/filter-panel/filter-panel.component';
import { MapService } from './map.service';

// Fix Leaflet default marker icon paths (use CDN URLs instead of imports)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
});

interface RadiusOption {
  value: number;
  label: string;
}

const RADIUS_OPTIONS: RadiusOption[] = [
  { value: 1, label: '1 km' },
  { value: 5, label: '5 km' },
  { value: 10, label: '10 km' },
  { value: 0, label: 'Ciudad' }
];

const SANTIAGO_CENTER: [number, number] = [-33.4489, -70.6693];
const DEFAULT_ZOOM = 13;

@Component({
  selector: 'app-map-view',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ArtistCardComponent,
    FilterPanelComponent
  ],
  templateUrl: './map-view.component.html',
  styleUrl: './map-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MapViewComponent implements OnInit, AfterViewInit {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly mapService = inject(MapService);
  private readonly filterChange$ = new Subject<void>();

  private map: L.Map | null = null;
  private markerClusterGroup: L.MarkerClusterGroup | null = null;
  private userMarker: L.CircleMarker | null = null;

  readonly radiusOptions = RADIUS_OPTIONS;
  readonly tattooStyles = TATTOO_STYLES;

  readonly viewMode = signal<'map' | 'list'>('map');
  readonly selectedRadius = signal<number>(10);
  readonly userLocation = signal<L.LatLngLiteral | null>(null);
  readonly locationLoading = signal(true);
  readonly showFilters = signal(false);

  // Filters from the filter panel (reuse partial filters)
  readonly selectedStyles = signal<string[]>([]);
  readonly minPrice = signal<number | undefined>(undefined);
  readonly maxPrice = signal<number | undefined>(undefined);
  readonly minRating = signal<number | undefined>(undefined);
  readonly certifiedOnly = signal<boolean | undefined>(undefined);
  readonly artistType = signal<'independent' | 'studio' | null>(null);

  readonly artists = this.mapService.artists;
  readonly loading = this.mapService.loading;
  readonly error = this.mapService.error;

  readonly artistList = computed(() => this.artists()?.data ?? []);

  constructor() {
    // React to filter changes with debounce
    this.filterChange$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadArtists());

    // React to artist data changes to update markers
    effect(() => {
      const data = this.artistList();
      if (this.map && this.markerClusterGroup) {
        this.updateMarkers(data);
      }
    });
  }

  ngOnInit(): void {
    this.requestUserLocation();
  }

  ngAfterViewInit(): void {
    this.initializeMap();
  }

  onViewModeChange(event: MatButtonToggleChange): void {
    this.viewMode.set(event.value);
    if (event.value === 'map') {
      // Invalidate map size after switching back to map view
      setTimeout(() => this.map?.invalidateSize(), 100);
    }
  }

  onRadiusChange(radius: number): void {
    this.selectedRadius.set(radius);
    this.filterChange$.next();
    this.updateMapZoom(radius);
  }

  toggleFilters(): void {
    this.showFilters.update((v) => !v);
  }

  onStyleToggle(slug: string, checked: boolean): void {
    const current = this.selectedStyles();
    const next = checked
      ? [...current, slug]
      : current.filter((s) => s !== slug);
    this.selectedStyles.set(next);
    this.filterChange$.next();
  }

  onMinRatingChange(rating: number): void {
    const current = this.minRating();
    this.minRating.set(current === rating ? undefined : rating);
    this.filterChange$.next();
  }

  onCertifiedChange(checked: boolean): void {
    this.certifiedOnly.set(checked ? true : undefined);
    this.filterChange$.next();
  }

  onArtistTypeChange(type: 'independent' | 'studio' | null): void {
    this.artistType.set(type);
    this.filterChange$.next();
  }

  clearAllFilters(): void {
    this.selectedStyles.set([]);
    this.minPrice.set(undefined);
    this.maxPrice.set(undefined);
    this.minRating.set(undefined);
    this.certifiedOnly.set(undefined);
    this.artistType.set(null);
    this.filterChange$.next();
  }

  private initializeMap(): void {
    // Guard: only initialize if the container exists (map view is shown)
    if (!this.mapContainer?.nativeElement) return;
    
    const center = this.userLocation() ?? { lat: SANTIAGO_CENTER[0], lng: SANTIAGO_CENTER[1] };
    
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [center.lat, center.lng],
      zoom: DEFAULT_ZOOM,
      zoomControl: true
    });

    L.tileLayer(environment.mapTileUrl, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(this.map);

    this.markerClusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true
    });
    this.map.addLayer(this.markerClusterGroup);

    // Add user location marker if available
    const loc = this.userLocation();
    if (loc) {
      this.addUserMarker(loc);
    }
  }

  private requestUserLocation(): void {
    if (!navigator.geolocation) {
      this.locationLoading.set(false);
      this.useDefaultLocation();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
        this.userLocation.set(loc);
        this.locationLoading.set(false);
        
        if (this.map) {
          this.map.setView([loc.lat, loc.lng], DEFAULT_ZOOM);
          this.addUserMarker(loc);
        }
        
        this.loadArtists();
      },
      () => {
        this.locationLoading.set(false);
        this.useDefaultLocation();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  private useDefaultLocation(): void {
    const defaultLoc = { lat: SANTIAGO_CENTER[0], lng: SANTIAGO_CENTER[1] };
    this.userLocation.set(defaultLoc);
    
    if (this.map) {
      this.map.setView([defaultLoc.lat, defaultLoc.lng], DEFAULT_ZOOM);
    }
    
    this.loadArtists();
  }

  private addUserMarker(loc: L.LatLngLiteral): void {
    if (this.userMarker) {
      this.map?.removeLayer(this.userMarker);
    }
    
    this.userMarker = L.circleMarker([loc.lat, loc.lng], {
      radius: 10,
      fillColor: '#c9a446',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(this.map!);
    
    this.userMarker.bindTooltip('Tu ubicación', { permanent: false, direction: 'top' });
  }

  private loadArtists(): void {
    const loc = this.userLocation();
    if (!loc) return;

    const filters: GeoFilters = {
      lat: loc.lat,
      lng: loc.lng,
      radiusKm: this.selectedRadius()
    };

    const styles = this.selectedStyles();
    if (styles.length > 0) filters.styles = styles;
    if (this.minPrice()) filters.minPrice = this.minPrice();
    if (this.maxPrice()) filters.maxPrice = this.maxPrice();
    if (this.minRating()) filters.minRating = this.minRating();
    if (this.certifiedOnly()) filters.certified = this.certifiedOnly();
    if (this.artistType()) filters.type = this.artistType();

    this.mapService.loadArtistsByLocation(filters);
  }

  private updateMarkers(artists: ArtistCard[]): void {
    if (!this.markerClusterGroup) return;

    this.markerClusterGroup.clearLayers();

    artists.forEach((artist) => {
      if (artist.latitude == null || artist.longitude == null) return;

      const marker = this.createArtistMarker(artist);
      this.markerClusterGroup!.addLayer(marker);
    });
  }

  private createArtistMarker(artist: ArtistCard): L.Marker {
    const icon = this.createArtistIcon(artist);
    const marker = L.marker([artist.latitude, artist.longitude], { icon });

    const popupContent = this.createPopupContent(artist);
    marker.bindPopup(popupContent, {
      maxWidth: 280,
      minWidth: 240,
      className: 'artist-popup'
    });

    return marker;
  }

  private createArtistIcon(artist: ArtistCard): L.DivIcon {
    const photoUrl = artist.profilePhotoUrl;
    const initials = artist.artistName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const innerHTML = photoUrl
      ? `<img src="${photoUrl}" alt="${artist.artistName}" class="marker-photo" />`
      : `<span class="marker-initials">${initials}</span>`;

    return L.divIcon({
      className: 'artist-marker',
      html: `<div class="artist-marker-inner${artist.isCertified ? ' certified' : ''}">${innerHTML}</div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -44]
    });
  }

  private createPopupContent(artist: ArtistCard): string {
    const stars = this.renderStars(artist.averageRating);
    const photo = artist.profilePhotoUrl
      ? `<img src="${artist.profilePhotoUrl}" alt="${artist.artistName}" class="popup-photo" />`
      : `<div class="popup-photo-placeholder">${artist.artistName.charAt(0)}</div>`;

    const styleText = artist.styles.length > 0 ? artist.styles[0] : 'Sin estilo';
    const priceText = artist.minSessionPrice.toLocaleString('es-CL');

    return `
      <div class="popup-content">
        <div class="popup-header">
          ${photo}
          <div class="popup-info">
            <h4 class="popup-name">${artist.artistName}</h4>
            <div class="popup-rating">${stars} <span class="rating-count">(${artist.reviewCount})</span></div>
            <div class="popup-style">${styleText}</div>
            <div class="popup-commune">${artist.commune}</div>
          </div>
        </div>
        <div class="popup-price">Desde $${priceText}</div>
        <div class="popup-actions">
          <a href="/artista/${artist.slug}" class="popup-btn popup-btn--view">Ver perfil</a>
          <a href="/artista/${artist.slug}" class="popup-btn popup-btn--book">Reservar</a>
        </div>
      </div>
    `;
  }

  private renderStars(rating: number): string {
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.5;
    let html = '';
    
    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        html += '★';
      } else if (i === fullStars && hasHalf) {
        html += '☆';
      } else {
        html += '☆';
      }
    }
    
    return `<span class="stars">${html}</span> <span class="rating-value">${rating.toFixed(1)}</span>`;
  }

  private updateMapZoom(radius: number): void {
    if (!this.map) return;

    // Adjust zoom based on radius
    const zoom = radius === 0 ? 11 : radius === 1 ? 15 : radius === 5 ? 14 : 13;
    this.map.setZoom(zoom);
  }
}
