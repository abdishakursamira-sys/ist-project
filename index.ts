export interface Recommendation {
  movieId: number;
  title: string;
  releaseYear: number | null;
  posterUrl: string | null;
  genres: string[];
  matchPercent: number;   // 0-100
  reason: string;         // why it was recommended
}

// Set by requireAuth after the JWT is verified.
declare global {
  namespace Express {
    interface Request { userId: string }
  }
}
