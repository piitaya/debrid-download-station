import {
  mdiAnimationPlay,
  mdiApps,
  mdiBookOpenVariant,
  mdiDownload,
  mdiEarth,
  mdiFolder,
  mdiGamepadVariant,
  mdiMovieOpen,
  mdiMusic,
  mdiSoccer,
  mdiStar,
  mdiTeddyBear,
  mdiTelevisionClassic,
} from '@mdi/js';
import type { CategoryIcon } from '../shared/types.js';

export * from '@mdi/js';

export const categoryIcons: Record<CategoryIcon, string> = {
  movie: mdiMovieOpen,
  tv: mdiTelevisionClassic,
  anime: mdiAnimationPlay,
  kids: mdiTeddyBear,
  documentary: mdiEarth,
  music: mdiMusic,
  book: mdiBookOpenVariant,
  game: mdiGamepadVariant,
  app: mdiApps,
  sport: mdiSoccer,
  star: mdiStar,
  download: mdiDownload,
  folder: mdiFolder,
};

export const categoryIcon = (icon: CategoryIcon | null | undefined): string =>
  (icon && categoryIcons[icon]) || mdiFolder;
