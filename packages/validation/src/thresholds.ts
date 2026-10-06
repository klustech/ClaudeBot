import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@ct/shared";
import { z } from "zod";

export const ValidationThresholdsSchema = z.object({
  minTrades: z.number().int().positive(),
  preferredTrades: z.number().int().positive(),
  minProfitFactor: z.number().positive(),
  preferredProfitFactor: z.number().positive(),
  maxDrawdown: z.number().positive().max(1),
  minOosExpectancyR: z.number(),
  minStabilityScore: z.number().min(0).max(100),
  walkForward: z.object({
    trainBars: z.number().int().positive(),
    testBars: z.number().int().positive(),
    stepBars: z.number().int().positive(),
    minProfitableFraction: z.number().min(0).max(1),
    maxConfigsPerWindow: z.number().int().positive(),
  }),
  monteCarlo: z.object({
    simulations: z.number().int().min(1000),
    maxRuinProbability: z.number().min(0).max(1),
    ruinDrawdown: z.number().positive().max(1),
    slippageSd: z.number().min(0),
    missedTradeProbability: z.number().min(0).max(1),
    feeMultiplierMax: z.number().min(1),
    payoutVariation: z.number().min(0),
  }),
  minDeflatedSharpeProbability: z.number().min(0).max(1),
  minConfidence: z.number().min(0).max(100),
  maxStrategyCorrelation: z.number().min(0).max(1),
  maxPortfolioStrategies: z.number().int().positive(),
  paperGraduationTrades: z.array(z.number().int().positive()).min(1),
  paperMinProfitFactor: z.number().positive(),
  paperMaxDrawdown: z.number().positive().max(1),
  paperMaxDeviationFromOos: z.number().positive(),
});

export type ValidationThresholds = z.infer<typeof ValidationThresholdsSchema>;

/** Loads protected thresholds. Claude may propose changes but may not edit this file. */
export function loadValidationThresholds(root = repoRoot()): ValidationThresholds {
  const p = join(root, "config/validation-thresholds.json");
  if (!existsSync(p)) throw new Error(`Missing ${p}`);
  return ValidationThresholdsSchema.parse(JSON.parse(readFileSync(p, "utf8")));
}
