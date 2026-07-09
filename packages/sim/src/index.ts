export {
  Kernel,
  SYSTEM_ISSUER,
  type SimSystem,
  type TickContext,
  type TickResult,
  type CommandHandler,
  type AccessGuard,
  type GuardedAccess,
  type SystemTelemetry,
  type KernelOptions,
} from './kernel.js';
export {
  World,
  Query,
  Component,
  SoAComponent,
  ObjectComponent,
  type FieldType,
  type SoASchema,
  type SoAViews,
  type SoAInit,
  type SystemAccess,
  type ObjectView,
  type ObjectMutView,
  type EntityInspection,
} from './ecs.js';
export { EventBus } from './eventBus.js';
export { TickDriver, BASE_TICKS_PER_SECOND, type Speed, type DriverOptions } from './driver.js';
export {
  CalendarSystem,
  calendarFromTick,
  TICKS_PER_DAY,
  DAYS_PER_SEASON,
  SEASONS_PER_YEAR,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
  SEASON_NAMES,
  type CalendarDate,
  type SeasonName,
  type DayStartedData,
  type SeasonStartedData,
  type YearStartedData,
} from './time.js';
export {
  recordReplay,
  verifyReplay,
  type ReplayScenario,
  type ReplayRecord,
  type ScheduledCommand,
  type HashSample,
  type VerifyResult,
} from './harness.js';
export {
  SaveManager,
  kernelSection,
  worldSection,
  SAVE_FORMAT_VERSION,
  type SaveSection,
  type CampaignSave,
  type CampaignSaveHeader,
  type Migration,
} from './persistence.js';
export type { KernelSaveState } from './kernel.js';
export type { WorldSaveState, ComponentSaveState, EncodedObjectValue } from './ecs.js';
export { generateWorld, worldHash } from './worldgen/pipeline.js';
export { classifyTile, tileVariant, fillDepressions } from './worldgen/stages.js';
export { hash01, valueNoise, fbm } from './worldgen/noise.js';
export {
  Biome,
  BIOME_COUNT,
  BIOME_NAMES,
  RiverMark,
  MAP_TILES,
  DEFAULT_PARAMS,
  type BiomeId,
  type MapSize,
  type LandmassStyle,
  type WorldGenParams,
  type WorldLayers,
  type WorldDef,
  type RiverPath,
  type WorldGenStage,
  type ProgressFn,
} from './worldgen/types.js';
export {
  registerVillageGameplay,
  defineVillageComponents,
  constructionSystem,
  VillageOps,
  VILLAGE_RADIUS_T1,
  VILLAGE_MIN_SPACING,
  CENTER_DEF_ID,
  type VillageGameplay,
  type VillageComponents,
  type TerrainAccessor,
  type PlacementVerdict,
} from './game/villages.js';
export {
  registerPopulationGameplay,
  FOOD_PER_PERSON_DAY,
  FORAGE_FLOOR,
  BIRTH_RATE,
  FAMINE_MORTALITY,
  type PopulationGameplay,
  type PopulationComponent,
  type StartingPopulation,
} from './game/population.js';
export { BUILDERS_PER_SITE, type VillageSettings } from './game/villages.js';
export {
  registerEconomyGameplay,
  ResourceLedger,
  BASE_STORAGE,
  OUTBOX_DAYS,
  type EconomyGameplay,
  type ResourceFlows,
} from './game/economy.js';
export {
  registerLogisticsGameplay,
  RoadGrid,
  PathService,
  HAULER_CAPACITY_WEIGHT,
  ROAD_COST_STONE,
  ROAD_SPEED,
  type LogisticsGameplay,
  type HaulerComponent,
} from './game/logistics.js';
export { HAULER_POOL_CAP } from './game/population.js';
export {
  registerSettlerGameplay,
  scoreSite,
  bestSiteNear,
  SETTLER_PARTY,
  SETTLER_CARRY,
  MIN_ADULTS_REMAINING,
  TIER2_REQUIREMENTS,
  type SettlerGameplay,
  type SettlerPartyComponent,
} from './game/settlers.js';
export { VILLAGE_RADIUS_T2 } from './game/villages.js';
export { INERT_MODIFIERS, type StatModifierView } from './game/economy.js';
export {
  registerKingdomGameplay,
  StatModifiers,
  KingdomLedger,
  STARTING_TREASURY,
  EDICT_CAP,
  ADVISOR_SALARY,
  TAX_RATES,
  OFFICES,
  type KingdomGameplay,
  type KingdomComponent,
  type CharacterComponent,
  type LedgerEntry,
  type Office,
} from './game/kingdom.js';
export {
  KnowledgeModel,
  hashKnowledge,
  type KnowledgeFact,
  type FactKind,
  type FactSource,
} from './ai/knowledge.js';
export { FogRegistry, fogQuery, type FogQuery } from './ai/fogQuery.js';
export {
  registerAiKernel,
  type AiGameplay,
  type AiKingdomInfo,
  type AiKernelOptions,
} from './ai/brain.js';
export { findBuildSite, type BuildSite } from './ai/placement.js';
export {
  detectNeeds,
  productionCapacity,
  housingCapacity,
  foodNeed,
  housingNeed,
  DEFAULT_NEED_EVALUATORS,
  type SettlementNeed,
  type NeedEvaluator,
  type NeedContext,
} from './ai/needs.js';
export {
  chooseBuildTarget,
  registerAiConstructionManager,
  type BuildIntent,
  type AiConstructionOptions,
} from './ai/manager.js';
export {
  computeConsiderations,
  planAwareNeeds,
  registerAiStrategicPlanner,
  defineAiPlanState,
  DEFAULT_PERSONALITY_WEIGHTS,
  DEFAULT_PLAN_ARCHETYPES,
  type PersonalityWeights,
  type Considerations,
  type PlanArchetype,
  type AiStrategicPlanner,
  type AiStrategicPlannerOptions,
  type AiDiplomacyContext,
} from './ai/planner.js';
export {
  registerDiplomacyGameplay,
  evaluateDeal,
  trustFactor,
  personalityMargin,
  napValue,
  pactValue,
  DiplomacyState,
  TRADE_VALUE,
  ACCEPT_THRESHOLD,
  GIFT_OPINION_PER_GOLD,
  MAX_GIFT_OPINION,
  GIFT_COOLDOWN_TICKS,
  INSULT_OPINION_DELTA,
  INSULT_COOLDOWN_TICKS,
  BREAK_PACT_OPINION_PENALTY,
  PACT_NAP,
  PACT_TRADE,
  type PactType,
  type DealEvaluation,
  type DiplomaticRelation,
  type DiplomacyOptions,
  type DiplomacyGameplay,
  type DiplomacyPersonality,
} from './game/diplomacy.js';
