import { describe, it, expect } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { calculateTripPoints } from '../../src/services/points-engine.js';

describe('Points Engine', () => {
  describe('HK region', () => {
    it('awards 1 point per HKD net earnings', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(30),
        region: 'HK',
        isSurge: false,
        vehicleType: 'UberX',
      });
      expect(points).toBe(30);
    });

    it('applies 1.5x surge multiplier', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(30),
        region: 'HK',
        isSurge: true,
        vehicleType: 'UberX',
      });
      expect(points).toBe(45); // 30 * 1.5
    });

    it('adds vehicle bonus for Black', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(100),
        region: 'HK',
        isSurge: false,
        vehicleType: 'Black',
      });
      expect(points).toBe(103); // 100 + 3
    });

    it('returns 0 for earnings below minimum (HKD 10)', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(5),
        region: 'HK',
        isSurge: false,
        vehicleType: 'UberX',
      });
      expect(points).toBe(0);
    });

    it('floors fractional points', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(29.89),
        region: 'HK',
        isSurge: false,
        vehicleType: 'UberX',
      });
      expect(points).toBe(29);
    });

    it('handles surge + vehicle bonus together', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(50),
        region: 'HK',
        isSurge: true,
        vehicleType: 'Comfort',
      });
      // 50 * 1.5 = 75 (floored) + 1 (Comfort bonus) = 76
      expect(points).toBe(76);
    });
  });

  describe('BR region', () => {
    it('awards 0.5 points per BRL net earnings', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(40),
        region: 'BR',
        isSurge: false,
        vehicleType: 'UberX',
      });
      expect(points).toBe(20); // 40 * 0.5
    });

    it('returns 0 for earnings below minimum (BRL 5)', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(3),
        region: 'BR',
        isSurge: false,
        vehicleType: 'UberX',
      });
      expect(points).toBe(0);
    });

    it('applies surge for BR', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(100),
        region: 'BR',
        isSurge: true,
        vehicleType: 'UberX',
      });
      expect(points).toBe(75); // 100 * 0.5 = 50, * 1.5 = 75
    });
  });

  describe('edge cases', () => {
    it('handles unknown vehicle type gracefully', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(30),
        region: 'HK',
        isSurge: false,
        vehicleType: 'UnknownType',
      });
      expect(points).toBe(30); // no bonus, no crash
    });

    it('handles null vehicle type', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(30),
        region: 'HK',
        isSurge: false,
        vehicleType: null,
      });
      expect(points).toBe(30);
    });

    it('never returns negative points', () => {
      const points = calculateTripPoints({
        netEarnings: new Decimal(0),
        region: 'HK',
        isSurge: false,
        vehicleType: 'UberX',
      });
      expect(points).toBe(0);
    });
  });
});
