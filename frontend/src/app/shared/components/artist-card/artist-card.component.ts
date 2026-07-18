import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ArtistCard, ShowcaseItem } from '../../../core/models/showcase.models';
import { SponsorBadgesComponent } from '../sponsor-badges/sponsor-badges.component';

@Component({
  selector: 'app-artist-card',
  standalone: true,
  imports: [RouterLink, DecimalPipe, MatIconModule, SponsorBadgesComponent],
  templateUrl: './artist-card.component.html',
  styleUrl: './artist-card.component.scss'
})
export class ArtistCardComponent {
  readonly item = input<ShowcaseItem | null>(null);
  readonly artist = input<ArtistCard | null>(null);

  protected readonly stars = [1, 2, 3, 4, 5];

  readonly cardArtist = computed(() => this.artist() ?? this.item()?.artist ?? null);
  readonly cardImage = computed(() => this.item()?.imageUrl ?? this.cardArtist()?.featuredImageUrl ?? this.cardArtist()?.profilePhotoUrl ?? '');
  readonly cardStyles = computed(() => this.cardArtist()?.styles.slice(0, 2) ?? []);
  readonly roundedRating = computed(() => Math.round(this.cardArtist()?.averageRating ?? 0));
  readonly formattedRate = computed(() => {
    const rate = this.cardArtist()?.hourlyRate;
    return rate != null ? '$' + rate.toLocaleString('es-CL') : '';
  });
}
