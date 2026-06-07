import type {State} from './state';
import type {
  GameType, ClimateWeather, IrritantWeather, EnergyWeather,
  ClearingWeather, CataclysmWeather, Terrain,
} from './data/interface';

export class Field implements State.Field {
  gameType: GameType;
  climateWeather?: ClimateWeather;
  irritantWeather?: IrritantWeather;
  energyWeather?: EnergyWeather;
  clearingWeather?: ClearingWeather;
  cataclysmWeather?: CataclysmWeather;
  isWeatherBoosted: boolean;
  terrain?: Terrain;
  isMagicRoom: boolean;
  isWonderRoom: boolean;
  isGravity: boolean;
  isAuraBreak?: boolean;
  isFairyAura?: boolean;
  isDarkAura?: boolean;
  isBeadsOfRuin?: boolean;
  isSwordOfRuin?: boolean;
  isTabletsOfRuin?: boolean;
  isVesselOfRuin?: boolean;
  attackerSide: Side;
  defenderSide: Side;

  constructor(field: Partial<State.Field> = {}) {
    this.gameType = field.gameType || 'Singles';
    this.terrain = field.terrain;
    this.climateWeather = field.climateWeather;
    this.irritantWeather = field.irritantWeather;
    this.energyWeather = field.energyWeather;
    this.clearingWeather = field.clearingWeather;
    this.cataclysmWeather = field.cataclysmWeather;
    this.isWeatherBoosted = !!field.isWeatherBoosted;
    this.isMagicRoom = !!field.isMagicRoom;
    this.isWonderRoom = !!field.isWonderRoom;
    this.isGravity = !!field.isGravity;
    this.isAuraBreak = field.isAuraBreak || false;
    this.isFairyAura = field.isFairyAura || false;
    this.isDarkAura = field.isDarkAura || false;
    this.isBeadsOfRuin = field.isBeadsOfRuin || false;
    this.isSwordOfRuin = field.isSwordOfRuin || false;
    this.isTabletsOfRuin = field.isTabletsOfRuin || false;
    this.isVesselOfRuin = field.isVesselOfRuin || false;

    this.attackerSide = new Side(field.attackerSide || {});
    this.defenderSide = new Side(field.defenderSide || {});
  }

  hasClimateWeather(...weathers: ClimateWeather[]) {
    return !!(this.climateWeather && weathers.includes(this.climateWeather));
  }

  hasIrritantWeather(...weathers: IrritantWeather[]) {
    return !!(this.irritantWeather && weathers.includes(this.irritantWeather));
  }

  hasEnergyWeather(...weathers: EnergyWeather[]) {
    return !!(this.energyWeather && weathers.includes(this.energyWeather));
  }

  hasClearingWeather(...weathers: ClearingWeather[]) {
    return !!(this.clearingWeather && weathers.includes(this.clearingWeather));
  }

  hasCataclysmWeather(...weathers: CataclysmWeather[]) {
    return !!(this.cataclysmWeather && weathers.includes(this.cataclysmWeather));
  }

  hasTerrain(...terrains: Terrain[]) {
    return !!(this.terrain && terrains.includes(this.terrain));
  }

  swap() {
    [this.attackerSide, this.defenderSide] = [this.defenderSide, this.attackerSide];
    return this;
  }

  clone() {
    return new Field({
      gameType: this.gameType,
      climateWeather: this.climateWeather,
      irritantWeather: this.irritantWeather,
      energyWeather: this.energyWeather,
      clearingWeather: this.clearingWeather,
      cataclysmWeather: this.cataclysmWeather,
      isWeatherBoosted: this.isWeatherBoosted,
      terrain: this.terrain,
      isMagicRoom: this.isMagicRoom,
      isWonderRoom: this.isWonderRoom,
      isGravity: this.isGravity,
      attackerSide: this.attackerSide,
      defenderSide: this.defenderSide,
      isAuraBreak: this.isAuraBreak,
      isDarkAura: this.isDarkAura,
      isFairyAura: this.isFairyAura,
      isBeadsOfRuin: this.isBeadsOfRuin,
      isSwordOfRuin: this.isSwordOfRuin,
      isTabletsOfRuin: this.isTabletsOfRuin,
      isVesselOfRuin: this.isVesselOfRuin,
    });
  }
}

export class Side implements State.Side {
  spikes: number;
  steelsurge: boolean;
  vinelash: boolean;
  wildfire: boolean;
  cannonade: boolean;
  volcalith: boolean;
  isSR: boolean;
  isReflect: boolean;
  isLightScreen: boolean;
  isProtected: boolean;
  isSeeded: boolean;
  isSaltCured: boolean;
  isForesight: boolean;
  isTailwind: boolean;
  isHelpingHand: boolean;
  isFlowerGift: boolean;
  isPowerTrick?: boolean;
  isFriendGuard: boolean;
  isAuroraVeil: boolean;
  isBattery: boolean;
  isPowerSpot: boolean;
  isSteelySpirit: boolean;
  isSwitching?: 'out' | 'in';
  isSteelBarbs: boolean;

  constructor(side: State.Side = {}) {
    this.spikes = side.spikes || 0;
    this.steelsurge = !!side.steelsurge;
    this.vinelash = !!side.vinelash;
    this.wildfire = !!side.wildfire;
    this.cannonade = !!side.cannonade;
    this.volcalith = !!side.volcalith;
    this.isSR = !!side.isSR;
    this.isReflect = !!side.isReflect;
    this.isLightScreen = !!side.isLightScreen;
    this.isProtected = !!side.isProtected;
    this.isSeeded = !!side.isSeeded;
    this.isSaltCured = !!side.isSaltCured;
    this.isForesight = !!side.isForesight;
    this.isTailwind = !!side.isTailwind;
    this.isHelpingHand = !!side.isHelpingHand;
    this.isFlowerGift = !!side.isFlowerGift;
    this.isPowerTrick = !!side.isPowerTrick;
    this.isFriendGuard = !!side.isFriendGuard;
    this.isAuroraVeil = !!side.isAuroraVeil;
    this.isBattery = !!side.isBattery;
    this.isPowerSpot = !!side.isPowerSpot;
    this.isSteelySpirit = !!side.isSteelySpirit;
    this.isSwitching = side.isSwitching;
    this.isSteelBarbs = !!side.isSteelBarbs;
  }

  clone() {
    return new Side(this);
  }
}
