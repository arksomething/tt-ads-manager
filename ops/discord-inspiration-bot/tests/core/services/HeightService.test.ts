import { HeightService } from '../../../src/core/services/HeightService';

describe('HeightService', () => {
  let heightService: HeightService;

  beforeEach(() => {
    heightService = new HeightService();
  });

  describe('validateHeight', () => {
    it('should validate valid height in feet and inches', () => {
      const result = heightService.validateHeight('5\'8"');
      expect(result.isValid).toBe(true);
      expect(result.heightInCm).toBeGreaterThan(0);
    });

    it('should validate valid height in centimeters', () => {
      const result = heightService.validateHeight('173cm');
      expect(result.isValid).toBe(true);
      expect(result.heightInCm).toBe(173);
    });

    it('should reject invalid height format', () => {
      const result = heightService.validateHeight('invalid');
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBeDefined();
    });

    it('should reject negative heights', () => {
      const result = heightService.validateHeight('-5\'8"');
      expect(result.isValid).toBe(false);
    });

    it('should handle heights above 100 as centimeters', () => {
      const result = heightService.validateHeight('180');
      expect(result.isValid).toBe(true);
      expect(result.heightInCm).toBe(180);
    });
  });

  describe('calculateHeight', () => {
    it('should calculate height projection for valid input', () => {
      const result = heightService.calculateHeight({
        heightStr: '5\'8"',
        age: 16,
        sex: '1',
      });

      expect(typeof result).not.toBe('string'); // Not an error
      if (typeof result !== 'string') {
        expect(result.currentHeightCm).toBeGreaterThan(0);
        expect(result.projection).toBeDefined();
        expect(result.projection.actual.cm).toBeGreaterThan(0);
        expect(result.projection.potential.cm).toBeGreaterThan(0);
        expect(result.presentation.predictedHeightDisplay).toBeDefined();
        expect(result.presentation.reasons.length).toBeGreaterThan(0);
      }
    });

    it('should calculate with parent heights', () => {
      const result = heightService.calculateHeight({
        heightStr: '5\'8"',
        age: 16,
        sex: '1',
        motherHeightStr: '5\'4"',
        fatherHeightStr: '6\'0"',
      });

      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.motherHeightCm).toBeGreaterThan(0);
        expect(result.fatherHeightCm).toBeGreaterThan(0);
      }
    });

    it('should calculate dream height probability when provided', () => {
      const result = heightService.calculateHeight({
        heightStr: '5\'8"',
        age: 16,
        sex: '1',
        dreamHeightStr: '6\'0"',
      });

      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.probabilityResult).toBeDefined();
        expect(result.probabilityResult?.probability).toBeGreaterThanOrEqual(0);
        expect(result.probabilityResult?.probability).toBeLessThanOrEqual(100);
      }
    });

    it('should return error string for invalid height', () => {
      const result = heightService.calculateHeight({
        heightStr: 'invalid',
        age: 16,
        sex: '1',
      });

      expect(typeof result).toBe('string');
    });

    it('should handle different age ranges', () => {
      const ages = [10, 15, 18, 25, 30];
      
      ages.forEach(age => {
        const result = heightService.calculateHeight({
          heightStr: '5\'8"',
          age,
          sex: '1',
        });

        expect(typeof result).not.toBe('string');
      });
    });

    it('should calculate percentile rank', () => {
      const result = heightService.calculateHeight({
        heightStr: '5\'8"',
        age: 16,
        sex: '1',
      });

      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        expect(result.percentileRank).toBeDefined();
        expect(result.percentileRank).toBeGreaterThanOrEqual(0);
        expect(result.percentileRank).toBeLessThanOrEqual(100);
        expect(result.presentation.percentileDisplay).toBeDefined();
      }
    });
  });

  describe('formatResults', () => {
    it('should format calculation results as text', () => {
      const result = heightService.calculateHeight({
        heightStr: '5\'8"',
        age: 16,
        sex: '1',
      });

      if (typeof result !== 'string') {
        const formatted = heightService.formatResults(result);
        
        expect(formatted).toContain('Height Calculation Results');
        expect(formatted).toContain('Current Height');
        expect(formatted).toContain('Age');
        expect(formatted).toContain('Projection');
        expect(formatted).toContain('Predicted Adult Height');
        expect(formatted).toContain('Best-Case Height');
        expect(formatted).toContain('Height Analysis');
      }
    });

    it('should include dream height probability in format when available', () => {
      const result = heightService.calculateHeight({
        heightStr: '5\'8"',
        age: 16,
        sex: '1',
        dreamHeightStr: '6\'0"',
      });

      if (typeof result !== 'string') {
        const formatted = heightService.formatResults(result);
        
        expect(formatted).toContain('Dream Height Probability');
        expect(formatted).toContain('Dream Height');
        expect(formatted).toContain('Probability');
      }
    });

    it('should build projection image data from the presentation layer', () => {
      const result = heightService.calculateHeight({
        heightStr: '173cm',
        age: 16,
        sex: '1',
        dreamHeightStr: '183cm',
      });

      expect(typeof result).not.toBe('string');
      if (typeof result !== 'string') {
        const imageData = heightService.buildProjectionImageData(result);

        expect(imageData.currentHeight).toBe(result.presentation.currentHeightDisplay);
        expect(imageData.predictedHeight).toBe(result.presentation.predictedHeightDisplay);
        expect(imageData.percentileDisplay).toBe(result.presentation.percentileDisplay);
        expect(imageData.currentAge).toBe(result.age);
      }
    });
  });
});


