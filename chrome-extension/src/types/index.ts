export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  driverId: string;
  region: string;
  email: string;
}

export interface UberTripResponse {
  uuid: string;
  cards: UberCard[];
  requestedAt?: number;
  isPoolType?: boolean;
  isSurge?: boolean;
}

export interface UberCard {
  type: string;
  [key: string]: unknown;
}

export interface UberActivityFeedResponse {
  activities: UberActivity[];
  [key: string]: unknown;
}

export interface UberActivity {
  uuid: string;
  activityTitle: string;
  formattedTotal: string;
  type: string;
  routing?: {
    webviewUrl?: string;
  };
}

export interface CapturedTrip {
  tripUuid: string;
  vehicleType?: string;
  requestedAt: number;
  durationSeconds?: number;
  distanceMeters?: number;
  pickupDistrict?: string;
  dropoffDistrict?: string;
  currency: string;
  fareAmount: number;
  serviceFee: number;
  bookingFee: number;
  tolls: number;
  tips: number;
  netEarnings: number;
  isPoolType: boolean;
  isSurge: boolean;
  uberPoints?: number;
  rawPayloadHash: string;
}

export type MessageType =
  | { type: 'UBER_TRIP_CAPTURED'; payload: UberTripResponse; rawBody: string }
  | { type: 'UBER_ACTIVITY_FEED_CAPTURED'; payload: UberActivityFeedResponse; rawBody: string }
  | { type: 'GET_AUTH'; }
  | { type: 'SET_AUTH'; auth: StoredAuth }
  | { type: 'LOGOUT' }
  | { type: 'GET_SYNC_STATUS' }
  | { type: 'SYNC_STATUS'; data: { pending: number; synced: number; lastSync?: string } };
