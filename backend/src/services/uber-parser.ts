import { createHash } from 'node:crypto';
import { logger } from '../config/logger.js';

export interface BreakdownItem {
  label: string;
  formattedValue: string;
  amount: number;
  style?: { font?: string; borderTop?: string; borderBottom?: string };
  disclaimers?: Array<{ text: string; type: string }>;
  items?: BreakdownItem[];
}

export interface ParsedTrip {
  tripUuid: string;
  requestedAt: number;
  vehicleType?: string;
  durationSeconds?: number;
  distanceMeters?: number;
  currency: string;

  pickupAddress?: string;
  dropoffAddress?: string;
  pickupDistrict?: string;
  dropoffDistrict?: string;

  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  mapImageUrl?: string;

  fareAmount: number;
  serviceFee: number;
  serviceFeePercent?: number;
  bookingFee: number;
  bookingFeePayment: number;
  otherEarnings: number;
  tolls: number;
  tips: number;
  surcharges: number;
  promotions: number;
  netEarnings: number;

  customerPayment: number;
  uberServiceFee: number;
  cashCollected: number;
  tripBalance: number;
  upfrontFare: number;
  commissionRate?: number;

  fareBreakdown: BreakdownItem[];

  isPoolType: boolean;
  isSurge: boolean;
  uberPoints?: number;
  dateRequested?: string;
  timeRequested?: string;
  tripNotes?: string;
  statusType?: string;

  rawPayloadHash: string;

  // Integrity
  parseWarnings: string[];
  parseConfidence: 'high' | 'medium' | 'low';
}

function parseAmount(str: string | number | undefined | null): number {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const cleaned = String(str).replace(/[^0-9.\-]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function isNegative(str: string | undefined | null): boolean {
  if (!str) return false;
  return str.includes('-') || str.startsWith('(');
}

function extractDistrict(fullAddress: string): string {
  if (!fullAddress) return '';
  const parts = fullAddress.split(',').map((s) => s.trim());
  // Brazilian format: "Street, Neighborhood - City - State, PostalCode, BR"
  // Try to extract the neighborhood from "Neighborhood - City" segment
  for (const part of parts) {
    const dashSegments = part.split(' - ').map((s) => s.trim());
    if (dashSegments.length >= 2) return dashSegments[0];
  }
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0];
}

function extractCoordsFromMapUrl(url: string): {
  pickupLat?: number; pickupLng?: number;
  dropoffLat?: number; dropoffLng?: number;
} {
  const result: any = {};
  try {
    const decoded = decodeURIComponent(url);

    // Google Maps format: pickup-pin|lat,lng
    const pickupMatch = decoded.match(/pickup-pin[^|]*\|(?:scale:\d\|)?(-?[\d.]+),(-?[\d.]+)/);
    if (pickupMatch) {
      result.pickupLat = parseFloat(pickupMatch[1]);
      result.pickupLng = parseFloat(pickupMatch[2]);
    }
    const dropoffMatch = decoded.match(/dropoff-pin[^|]*\|(?:scale:\d\|)?(-?[\d.]+),(-?[\d.]+)/);
    if (dropoffMatch) {
      result.dropoffLat = parseFloat(dropoffMatch[1]);
      result.dropoffLng = parseFloat(dropoffMatch[2]);
    }

    // Uber static-maps format: marker=lat:XX$lng:YY$icon:...pickup-pin...
    if (!result.pickupLat) {
      const markers = decoded.match(/marker=([^&]+)/g) || [];
      for (const m of markers) {
        const latM = m.match(/lat[:%3A]+(-?[\d.]+)/);
        const lngM = m.match(/lng[:%3A]+(-?[\d.]+)/);
        if (!latM || !lngM) continue;
        const lat = parseFloat(latM[1]);
        const lng = parseFloat(lngM[1]);
        if (m.includes('pickup')) {
          result.pickupLat = lat;
          result.pickupLng = lng;
        } else if (m.includes('dropoff')) {
          result.dropoffLat = lat;
          result.dropoffLng = lng;
        }
      }
    }
  } catch {}
  return result;
}

/**
 * Recursively converts the raw Uber breakdown items into our structured tree,
 * preserving every single line item regardless of nesting depth.
 */
function parseBreakdownTree(items: any[]): BreakdownItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const bi: BreakdownItem = {
      label: item.label || '',
      formattedValue: item.formattedValue || '',
      amount: parseAmount(item.formattedValue),
    };
    if (isNegative(item.formattedValue)) bi.amount = -Math.abs(bi.amount);
    if (item.style) bi.style = item.style;
    if (item.disclaimers?.length) bi.disclaimers = item.disclaimers;
    if (item.items?.length) bi.items = parseBreakdownTree(item.items);
    return bi;
  });
}

/**
 * Walk every node in the breakdown tree, yielding {label, amount, disclaimers, depth}.
 */
function* walkBreakdown(items: BreakdownItem[], depth = 0): Generator<{
  label: string; amount: number; disclaimers?: Array<{ text: string; type: string }>;
  depth: number; formattedValue: string;
}> {
  for (const item of items) {
    yield { label: item.label, amount: item.amount, disclaimers: item.disclaimers, depth, formattedValue: item.formattedValue };
    if (item.items?.length) yield* walkBreakdown(item.items, depth + 1);
  }
}

export function parseUberTripResponse(rawBody: string, tripUuid: string): ParsedTrip | null {
  try {
    const raw = JSON.parse(rawBody);
    if (raw.status === 'failure') return null;

    const data = raw.data && raw.status === 'success' ? raw.data : raw;
    const metadata = data.metadata || {};

    if (!tripUuid) {
      tripUuid = data.uuid || data.tripUUID || metadata.uuid || '';
      if (!tripUuid) {
        logger.warn({ keys: Object.keys(data) }, 'No trip UUID');
        return null;
      }
    }

    const result: ParsedTrip = {
      tripUuid,
      requestedAt: metadata.requestedAt || Math.floor(Date.now() / 1000),
      isPoolType: metadata.isPoolType === true,
      isSurge: metadata.isSurge === true,
      statusType: metadata.statusType,
      currency: rawBody.includes('HK$') ? 'HKD' : rawBody.includes('R$') ? 'BRL' : 'USD',
      fareAmount: 0,
      serviceFee: 0,
      bookingFee: 0,
      bookingFeePayment: 0,
      otherEarnings: 0,
      tolls: 0,
      tips: 0,
      surcharges: 0,
      promotions: 0,
      netEarnings: 0,
      customerPayment: 0,
      uberServiceFee: 0,
      cashCollected: 0,
      tripBalance: 0,
      upfrontFare: 0,
      fareBreakdown: [],
      rawPayloadHash: createHash('sha256').update(rawBody).digest('hex'),
      parseWarnings: [],
      parseConfidence: 'high',
    };

    // Flatten all components from all cards
    const components: any[] = [];
    for (const card of data.cards || []) {
      if (card.components) components.push(...card.components);
    }

    const findComp = (...types: string[]) =>
      components.find((c: any) => types.includes(c.type));
    const findAllComps = (...types: string[]) =>
      components.filter((c: any) => types.includes(c.type));

    // --- heroV2: vehicle type, earnings, date/time ---
    const heroComp = findComp('heroV2', 'hero');
    const hero = heroComp?.heroV2 || heroComp?.hero || {};
    if (hero.vehicleType) result.vehicleType = hero.vehicleType;
    if (hero.text) result.netEarnings = parseAmount(hero.text);
    result.dateRequested = hero.dateRequested || undefined;
    result.timeRequested = hero.timeRequested || undefined;
    if (hero.dateRequested && hero.timeRequested) {
      try {
        const ts = Date.parse(`${hero.dateRequested} ${hero.timeRequested}`);
        if (!isNaN(ts)) result.requestedAt = Math.floor(ts / 1000);
      } catch {}
    }

    // --- styledIconLink: notifications/messages ---
    const notes: string[] = [];
    for (const comp of findAllComps('styledIconLink')) {
      const title = comp.styledIconLink?.title?.text;
      if (title) notes.push(title);
    }
    if (notes.length) result.tripNotes = notes.join(' | ');

    // --- image: map URL + coordinates ---
    const imgComp = findComp('image');
    const mapUrl = imgComp?.image?.url || metadata.customRouteMap || '';
    if (mapUrl && (mapUrl.includes('maps.googleapis.com') || mapUrl.includes('static-maps.uber.com'))) {
      result.mapImageUrl = mapUrl;
      const coords = extractCoordsFromMapUrl(mapUrl);
      if (coords.pickupLat) result.pickupLat = coords.pickupLat;
      if (coords.pickupLng) result.pickupLng = coords.pickupLng;
      if (coords.dropoffLat) result.dropoffLat = coords.dropoffLat;
      if (coords.dropoffLng) result.dropoffLng = coords.dropoffLng;
    }

    // --- statTable: duration + distance ---
    const statComp = findComp('statTable', 'statsTable', 'tripStats');
    for (const stat of statComp?.statTable?.stats || statComp?.statsTable?.stats || []) {
      const label = (stat.label || '').toLowerCase();
      const value = stat.value || '';

      if (label.includes('duration') || label.includes('time') || label.includes('tempo')) {
        let totalSec = 0;
        const hr = value.match(/(\d+)\s*(?:hr|hour|h\b|hora)/i);
        const min = value.match(/(\d+)\s*min/i);
        const sec = value.match(/(\d+)\s*sec/i);
        if (hr) totalSec += parseInt(hr[1]) * 3600;
        if (min) totalSec += parseInt(min[1]) * 60;
        if (sec) totalSec += parseInt(sec[1]);
        if (totalSec > 0) result.durationSeconds = totalSec;
      }

      if (label.includes('distance') || label.includes('dist') || label.includes('distância')) {
        const km = value.match(/([\d.]+)\s*km/i);
        const mi = value.match(/([\d.]+)\s*mi/i);
        if (km) result.distanceMeters = Math.round(parseFloat(km[1]) * 1000);
        else if (mi) result.distanceMeters = Math.round(parseFloat(mi[1]) * 1609.34);
      }
    }

    // --- addressBlockV2: pickup + dropoff ---
    const addrComp = findComp('addressBlockV2', 'addressBlock', 'addressStack');
    const addresses = addrComp?.addressBlockV2?.addresses
      || addrComp?.addressBlock?.addresses
      || addrComp?.addressStack?.addresses
      || [];
    for (const addr of addresses) {
      const type = (addr.type || '').toUpperCase();
      const fullAddr = addr.address || addr.title || addr.shortName || '';
      if (type === 'PICKUP' || addresses.indexOf(addr) === 0) {
        result.pickupAddress = fullAddr;
        result.pickupDistrict = extractDistrict(fullAddr);
      }
      if (type === 'DROPOFF' || addresses.indexOf(addr) === 1) {
        result.dropoffAddress = fullAddr;
        result.dropoffDistrict = extractDistrict(fullAddr);
      }
    }

    // --- statListItemV2: Uber points ---
    const pointsComp = findComp('statListItemV2', 'statListItem');
    const pointsLabel = pointsComp?.statListItemV2?.label || pointsComp?.statListItem?.label || '';
    if (pointsLabel) {
      const pts = pointsLabel.match(/(\d+)\s*point/i);
      if (pts) result.uberPoints = parseInt(pts[1]);
    }

    // --- breakdownListV2: FULL fare breakdown tree ---
    const breakdownComp = findComp('breakdownListV2', 'breakdownList', 'fareBreakdown');
    const rawBreakdownItems = breakdownComp?.breakdownListV2?.items
      || breakdownComp?.breakdownList?.items
      || breakdownComp?.fareBreakdown?.items
      || [];

    result.fareBreakdown = parseBreakdownTree(rawBreakdownItems);

    // Walk every node in the tree to extract known fields generically
    for (const node of walkBreakdown(result.fareBreakdown)) {
      const label = node.label.toLowerCase();
      const val = Math.abs(node.amount);
      const neg = node.amount < 0 || isNegative(node.formattedValue);

      // Top-level "Fare" (the composite fare amount, not sub-items like "Wait Time")
      if (node.depth === 0 && (label === 'fare' || label === 'trip fare' || label === 'base fare'
        || label === 'tarifa' || label === 'valor da corrida')) {
        result.fareAmount = val;
      }

      // Service fee (any depth)
      if (label.includes('service fee') || label.includes('taxa de serviço')) {
        result.serviceFee = val;
        for (const disc of node.disclaimers || []) {
          const pctMatch = (disc.text || '').match(/([\d.]+)%/);
          if (pctMatch) result.serviceFeePercent = parseFloat(pctMatch[1]);
        }
      }

      // Net earnings / your earnings (top-level bold line)
      if (node.depth === 0 && (label === 'your earnings' || label === 'you earned'
        || label === 'seus ganhos' || label === 'ganhos')) {
        result.netEarnings = node.amount;
      }

      // Toll (any depth)
      if (label === 'toll' || label === 'tolls' || label.includes('pedágio')) {
        result.tolls += val;
      }

      // Tip (any depth)
      if (label.includes('tip') || label.includes('gratuity') || label.includes('gorjeta')) {
        result.tips += val;
      }

      // Surcharge (any depth)
      if (label.includes('surcharge') || label.includes('sobretaxa')) {
        result.surcharges += val;
      }

      // Promotions / discounts (any depth)
      if (label.includes('promot') || label.includes('promoção') || label.includes('discount') || label.includes('desconto')) {
        result.promotions += val;
      }

      // Booking fee deduction (any depth)
      if (label.includes('booking fee') && (label.includes('deduction') || label.includes('deducción'))) {
        result.bookingFee = val;
      }

      // Booking fee payment (any depth)
      if (label.includes('booking fee') && (label.includes('payment') || label.includes('pago'))) {
        result.bookingFeePayment = val;
      }

      // Other earnings (top-level only)
      if (node.depth === 0 && (label.includes('other earning') || label.includes('outros ganhos'))) {
        result.otherEarnings = node.amount;
      }
    }

    // --- Extract data from additional card types (BR-specific) ---
    for (const card of data.cards || []) {
      // Customer fare breakdown (TripAllPartiesBreakdownCard)
      if (card.type === 'TripAllPartiesBreakdownCard') {
        for (const comp of card.components || []) {
          if (comp.breakdownListV2?.items) {
            for (const item of comp.breakdownListV2.items) {
              const label = (item.label || '').toLowerCase().trim();
              const val = parseAmount(item.formattedValue);
              if (label.includes('customer payment') || label.includes('pagamento')) {
                result.customerPayment = Math.abs(val);
              }
              if (label.includes('paid to uber') || label.includes('pago à uber') || label.includes('pago ao uber')) {
                result.uberServiceFee = Math.abs(val);
              }
            }
          }
        }
      }

      // Commission rate (TripEffectiveCommissionRateCard)
      if (card.type === 'TripEffectiveCommissionRateCard') {
        for (const comp of card.components || []) {
          const text = comp.styledIconLink?.title?.text || '';
          const pctMatch = text.match(/([\d.]+)%/);
          if (pctMatch) result.commissionRate = parseFloat(pctMatch[1]);
        }
      }

      // Upfront fare (SpotUfpBreakdownCard)
      if (card.type === 'SpotUfpBreakdownCard') {
        for (const comp of card.components || []) {
          if (comp.breakdownListV2?.items) {
            for (const item of comp.breakdownListV2.items) {
              const label = (item.label || '').toLowerCase();
              if (label === 'total' || label === 'fare') {
                result.upfrontFare = parseAmount(item.formattedValue);
              }
            }
          }
        }
      }

      // Cash collected & trip balance from TripBreakdownCardV2
      if (card.type === 'TripBreakdownCardV2') {
        for (const comp of card.components || []) {
          if (comp.breakdownListV2?.items) {
            for (const item of comp.breakdownListV2.items) {
              const label = (item.label || '').toLowerCase();
              if (label === 'trip balance' || label === 'saldo da viagem') {
                result.tripBalance = parseAmount(item.formattedValue);
              }
              for (const sub of item.items || []) {
                const subLabel = (sub.label || '').toLowerCase();
                if (subLabel.includes('cash collected') || subLabel.includes('dinheiro coletado')) {
                  result.cashCollected = Math.abs(parseAmount(sub.formattedValue));
                }
              }
            }
          }
        }
      }
    }

    // Ensure fareAmount >= netEarnings
    if (result.fareAmount === 0 && result.netEarnings > 0) {
      result.fareAmount = result.netEarnings;
    }
    if (result.netEarnings > result.fareAmount) {
      result.fareAmount = result.netEarnings;
    }

    // --- Parse integrity checks ---
    const warnings: string[] = [];

    const hasCards = (data.cards || []).length > 0;
    const hasComponents = components.length > 0;

    if (!hasCards) warnings.push('NO_CARDS: Uber response contained no cards — API structure may have changed');
    if (hasCards && !hasComponents) warnings.push('NO_COMPONENTS: Cards found but no components — possible schema change');
    if (!result.vehicleType) warnings.push('NO_VEHICLE_TYPE: Could not extract vehicle type');
    if (!result.dateRequested && !result.timeRequested) warnings.push('NO_DATE_TIME: Could not extract date/time');
    if (result.fareBreakdown.length === 0 && hasCards) warnings.push('NO_BREAKDOWN: Has cards but fare breakdown is empty — breakdown format may have changed');
    if (result.netEarnings === 0 && result.fareAmount === 0 && hasCards) warnings.push('ZERO_EARNINGS: Both fare and net earnings are zero despite having card data');
    if (!result.pickupAddress && !result.dropoffAddress) warnings.push('NO_ADDRESSES: Could not extract any addresses');
    if (result.fareAmount > 0 && result.serviceFee === 0) warnings.push('NO_SERVICE_FEE: Fare exists but no service fee detected — breakdown structure may differ');

    // Check for unknown component types that might indicate API changes
    const knownTypes = new Set(['heroV2', 'hero', 'image', 'statTable', 'statsTable', 'tripStats',
      'addressBlockV2', 'addressBlock', 'addressStack', 'statListItemV2', 'statListItem',
      'breakdownListV2', 'breakdownList', 'fareBreakdown', 'styledIconLink', 'header']);
    const unknownTypes = components.filter((c: any) => !knownTypes.has(c.type)).map((c: any) => c.type);
    if (unknownTypes.length > 0) warnings.push(`UNKNOWN_COMPONENTS: ${unknownTypes.join(', ')} — new Uber component types detected`);

    result.parseWarnings = warnings;

    if (warnings.some(w => w.startsWith('NO_CARDS') || w.startsWith('NO_COMPONENTS') || w.startsWith('ZERO_EARNINGS'))) {
      result.parseConfidence = 'low';
    } else if (warnings.length > 2 || warnings.some(w => w.startsWith('NO_BREAKDOWN'))) {
      result.parseConfidence = 'medium';
    } else {
      result.parseConfidence = 'high';
    }

    logger.info(
      {
        tripUuid: result.tripUuid,
        vehicle: result.vehicleType,
        fare: result.fareAmount,
        net: result.netEarnings,
        confidence: result.parseConfidence,
        warnings: warnings.length > 0 ? warnings : undefined,
        breakdownItemCount: result.fareBreakdown.length,
      },
      'Parsed Uber trip',
    );

    return result;
  } catch (e) {
    logger.error({ err: e }, 'Failed to parse Uber trip response');
    return null;
  }
}
