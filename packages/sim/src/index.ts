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
  BASE_STORAGE,
  BIRTH_RATE,
  FAMINE_MORTALITY,
  type PopulationGameplay,
  type PopulationComponent,
  type StartingPopulation,
} from './game/population.js';
export { BUILDERS_PER_SITE, type VillageSettings } from './game/villages.js';
