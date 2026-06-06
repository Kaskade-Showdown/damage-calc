import type {Generation, AbilityName, StatID, Terrain} from '../data/interface';
import {toID} from '../util';
import {
  getBerryResistType,
  getFlingPower,
  getItemBoostType,
  getMultiAttack,
  getNaturalGift,
  getTechnoBlast,
  SEED_BOOSTED_STAT,
} from '../items';
import type {RawDesc} from '../desc';
import type {Field} from '../field';
import type {Move} from '../move';
import type {Pokemon} from '../pokemon';
import {Result} from '../result';
import {
  chainMods,
  checkAirLock,
  checkDauntlessShield,
  checkDownload,
  checkEmbody,
  checkForecast,
  checkInfiltrator,
  checkIntimidate,
  checkIntrepidSword,
  checkItem,
  checkMultihitBoost,
  checkSeedBoost,
  checkTeraformZero,
  checkWindRider,
  checkRawStatChanges,
  computeFinalStats,
  countBoosts,
  getBaseDamage,
  getStatDescriptionText,
  getFinalDamage,
  getModifiedStat,
  getQPBoostedStat,
  getMoveEffectiveness,
  getShellSideArmCategory,
  getWeight,
  handleFixedDamageMoves,
  isGrounded,
  OF16, OF32,
  pokeRound,
  isQPActive,
  getStabMod,
  getStellarStabMod,
  checkNullify,
} from './util';

export function calculateSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field
) {
  // #region Initial

  checkAirLock(attacker, field);
  checkAirLock(defender, field);
  checkTeraformZero(attacker, field);
  checkTeraformZero(defender, field);
  checkForecast(attacker, field);
  checkForecast(defender, field);
  checkNullify(attacker, field);
  checkNullify(defender, field);

  if (field.isWeatherBoosted) {
    if (field.hasIrritantWeather('Pollen')) field.terrain = 'Grassy';
    else if (field.hasIrritantWeather('Fairy Dust')) field.terrain = 'Misty';
    else if (field.hasEnergyWeather('Dreamscape')) field.terrain = 'Psychic';
    else if (field.hasEnergyWeather('Thunderstorm')) field.terrain = 'Electric';
  }
  if (field.hasIrritantWeather('Fairy Dust') &&
      (attacker.hasAbility('Druidry') || defender.hasAbility('Druidry'))) {
    field.terrain = 'Grassy';
  }

  checkItem(attacker, field.isMagicRoom);
  checkItem(defender, field.isMagicRoom);
  checkRawStatChanges(attacker, field.attackerSide.isPowerTrick, field.isWonderRoom);
  checkRawStatChanges(defender, field.defenderSide.isPowerTrick, field.isWonderRoom);
  checkSeedBoost(attacker, field);
  checkSeedBoost(defender, field);
  checkDauntlessShield(attacker, gen);
  checkDauntlessShield(defender, gen);
  checkEmbody(attacker, gen);
  checkEmbody(defender, gen);

  computeFinalStats(gen, attacker, defender, field, 'def', 'spd', 'spe');

  checkIntimidate(gen, attacker, defender);
  checkIntimidate(gen, defender, attacker);
  checkDownload(attacker, defender, field.isWonderRoom);
  checkDownload(defender, attacker, field.isWonderRoom);
  checkIntrepidSword(attacker, gen);
  checkIntrepidSword(defender, gen);

  checkWindRider(attacker, field.attackerSide, field);
  checkWindRider(defender, field.defenderSide, field);

  if (move.named('Meteor Beam', 'Electro Shot')) {
    attacker.boosts.spa +=
      attacker.hasAbility('Simple') ? 2
      : attacker.hasAbility('Contrary') ? -1
      : 1;
    // restrict to +- 6
    attacker.boosts.spa = Math.min(6, Math.max(-6, attacker.boosts.spa));
  }

  computeFinalStats(gen, attacker, defender, field, 'atk', 'spa');

  checkInfiltrator(attacker, field.defenderSide);
  checkInfiltrator(defender, field.attackerSide);

  const desc: RawDesc = {
    attackerName: attacker.name,
    moveName: move.name,
    defenderName: defender.name,
    isDefenderDynamaxed: defender.isDynamaxed,
    isWonderRoom: field.isWonderRoom,
  };

  // only display tera type if it applies
  if (attacker.teraType !== 'Stellar' || move.name === 'Tera Blast' || move.isStellarFirstUse) {
    // tera blast has special behavior with tera stellar
    desc.isStellarFirstUse = attacker.name !== 'Terapagos-Stellar' && move.name === 'Tera Blast' &&
      attacker.teraType === 'Stellar' && move.isStellarFirstUse;
    desc.attackerTera = attacker.teraType;
  }
  if (defender.teraType !== 'Stellar') desc.defenderTera = defender.teraType;

  if (move.named('Photon Geyser', 'Light That Burns the Sky') ||
      (move.named('Tera Blast') && attacker.teraType) ||
      (move.named('Tera Starstorm') && attacker.teraType && attacker.named('Terapagos-Stellar'))) {
    move.category = attacker.stats.atk > attacker.stats.spa ? 'Physical' : 'Special';
  }

  const result = new Result(gen, attacker, defender, move, field, 0, desc);

  if (move.category === 'Status' && !move.named('Nature Power')) {
    return result;
  }

  if (move.flags.punch && attacker.hasItem('Punching Glove')) {
    desc.attackerItem = attacker.item;
    move.flags.contact = 0;
  }

  if (move.named('Shell Side Arm') &&
    getShellSideArmCategory(attacker, defender, field.isWonderRoom) === 'Physical') {
    move.category = 'Physical';
    move.flags.contact = 1;
  }

  const breaksProtect = move.breaksProtect || move.isZ || attacker.isDynamaxed ||
  (move.flags.contact && (attacker.hasAbility('Unseen Fist', 'Piercing Drill') ||
  (attacker.hasAbility('Trained Eye') && field.hasEnergyWeather('Battle Aura') &&
    !attacker.hasItem('Energy Nullifier'))));

  if (field.defenderSide.isProtected && !breaksProtect) {
    desc.isProtected = true;
    return result;
  }

  if (move.name === 'Pain Split') {
    const average = Math.floor((attacker.curHP() + defender.curHP()) / 2);
    const damage = Math.max(0, defender.curHP() - average);
    result.damage = damage;
    return result;
  }

  const defenderAbilityIgnored = defender.hasAbility(
    'Armor Tail', 'Aroma Veil', 'Aura Break', 'Battle Armor',
    'Big Pecks', 'Bulletproof', 'Clear Body', 'Contrary',
    'Damp', 'Dazzling', 'Disguise', 'Dry Skin',
    'Earth Eater', 'Filter', 'Flash Fire', 'Flower Gift',
    'Flower Veil', 'Fluffy', 'Friend Guard', 'Fur Coat',
    'Good as Gold', 'Grass Pelt', 'Guard Dog', 'Heatproof',
    'Heavy Metal', 'Hyper Cutter', 'Ice Face', 'Ice Scales',
    'Illuminate', 'Immunity', 'Inner Focus', 'Insomnia',
    'Keen Eye', 'Leaf Guard', 'Levitate', 'Light Metal',
    'Lightning Rod', 'Limber', 'Magic Bounce', 'Magma Armor',
    'Marvel Scale', "Mind's Eye", 'Mirror Armor', 'Motor Drive',
    'Multiscale', 'Oblivious', 'Overcoat', 'Own Tempo',
    'Pastel Veil', 'Punk Rock', 'Purifying Salt', 'Queenly Majesty',
    'Sand Veil', 'Sap Sipper', 'Shell Armor', 'Shield Dust',
    'Simple', 'Snow Cloak', 'Solid Rock', 'Soundproof',
    'Sticky Hold', 'Storm Drain', 'Sturdy', 'Suction Cups',
    'Sweet Veil', 'Tangled Feet', 'Telepathy', 'Tera Shell',
    'Thermal Exchange', 'Thick Fat', 'Unaware', 'Vital Spirit',
    'Volt Absorb', 'Water Absorb', 'Water Bubble', 'Water Veil',
    'Well-Baked Body', 'White Smoke', 'Wind Rider', 'Wonder Guard',
    'Wonder Skin',
    'Flytrap', 'Foil', 'Glacial Armor', 'Hydrophobic', 'Power Plumage', 'Relic Soul', 'Rocky Body',
  );

  const attackerIgnoresAbility = attacker.hasAbility('Mold Breaker', 'Teravolt', 'Turboblaze');
  const moveIgnoresAbility = move.named(
    'G-Max Drum Solo',
    'G-Max Fire Ball',
    'G-Max Hydrosnipe',
    'Light That Burns the Sky',
    'Menacing Moonraze Maelstrom',
    'Moongeist Beam',
    'Photon Geyser',
    'Searing Sunraze Smash',
    'Sunsteel Strike'
  );

  if (defenderAbilityIgnored && (attackerIgnoresAbility || moveIgnoresAbility)) {
    if (attackerIgnoresAbility) desc.attackerAbility = attacker.ability;
    if (defender.hasItem('Ability Shield')) {
      desc.defenderItem = defender.item;
    } else {
      defender.ability = '' as AbilityName;
    }
  }

  const ignoresNeutralizingGas = [
    'As One (Glastrier)', 'As One (Spectrier)', 'Battle Bond', 'Comatose',
    'Disguise', 'Gulp Missile', 'Ice Face', 'Multitype', 'Neutralizing Gas',
    'Power Construct', 'RKS System', 'Schooling', 'Shields Down',
    'Stance Change', 'Tera Shift', 'Zen Mode', 'Zero to Hero',
    'Neutralize', 'Rocky Body', 'Swarming',
  ];

  if (attacker.hasAbility('Neutralizing Gas', 'Neutralize') &&
    !ignoresNeutralizingGas.includes(defender.ability || '')) {
    desc.attackerAbility = attacker.ability;
    if (defender.hasItem('Ability Shield')) {
      desc.defenderItem = defender.item;
    } else {
      defender.ability = '' as AbilityName;
    }
  }

  if (defender.hasAbility('Neutralizing Gas', 'Neutralize') &&
    !ignoresNeutralizingGas.includes(attacker.ability || '')) {
    desc.defenderAbility = defender.ability;
    if (attacker.hasItem('Ability Shield')) {
      desc.attackerItem = attacker.item;
    } else {
      attacker.ability = '' as AbilityName;
    }
  }

  // Merciless does not ignore Shell Armor, damage dealt to a poisoned Pokemon with Shell Armor
  // will not be a critical hit (UltiMario)
  const isCritical = !defender.hasAbility('Battle Armor', 'Shell Armor') &&
    (move.isCrit ||
     (attacker.hasAbility('Merciless') && defender.hasStatus('psn', 'tox', 'blt')) ||
     (field.hasClimateWeather('Blood Moon') && field.isWeatherBoosted &&
      move.hasType('Dark') && move.bp > 0 && move.bp <= 60)
    ) &&
    move.timesUsed === 1;

  let type = move.type;
  if (move.originalName === 'Weather Ball') {
    const holdingUmbrella = attacker.hasItem('Utility Umbrella');
    const holdingGoggles = attacker.hasItem('Safety Goggles');
    const holdingNullifier = attacker.hasItem('Energy Nullifier');
    const isMegaSol = attacker.hasAbility('Mega Sol');
    if (attacker.hasItem('Weather Vane') && attacker.name.startsWith('Castform-')) {
      type = attacker.types[0];
      desc.moveType = type;
      desc.attackerItem = attacker.item;
    } else if (isMegaSol) {
      type = 'Fire';
      desc.attackerAbility = attacker.ability;
    } else if (field.hasClimateWeather('Sun', 'Desolate Land') && !holdingUmbrella) {
      type = 'Fire'; desc.climateWeather = field.climateWeather;
    } else if (field.hasClimateWeather('Rain', 'Primordial Sea') && !holdingUmbrella) {
      type = 'Water'; desc.climateWeather = field.climateWeather;
    } else if (field.hasClimateWeather('Hail', 'Snow')) {
      type = 'Ice'; desc.climateWeather = field.climateWeather;
    } else if (field.hasClimateWeather('Blood Moon')) {
      type = 'Dark'; desc.climateWeather = field.climateWeather;
    } else if (field.hasIrritantWeather('Sand') && !holdingGoggles) {
      type = 'Rock'; desc.irritantWeather = field.irritantWeather;
    } else if (field.hasIrritantWeather('Dust') && !holdingGoggles) {
      type = 'Ground'; desc.irritantWeather = field.irritantWeather;
    } else if (field.hasIrritantWeather('Pollen') && !holdingGoggles) {
      type = 'Grass'; desc.irritantWeather = field.irritantWeather;
    } else if (field.hasIrritantWeather('Pheromones') && !holdingGoggles) {
      type = 'Bug'; desc.irritantWeather = field.irritantWeather;
    } else if (field.hasIrritantWeather('Smog') && !holdingGoggles) {
      type = 'Poison'; desc.irritantWeather = field.irritantWeather;
    } else if (field.hasIrritantWeather('Fairy Dust') && !holdingGoggles) {
      type = 'Fairy'; desc.irritantWeather = field.irritantWeather;
    } else if (field.hasEnergyWeather('Battle Aura') && !holdingNullifier) {
      type = 'Fighting'; desc.energyWeather = field.energyWeather;
    } else if (field.hasEnergyWeather('Paranormal Activity') && !holdingNullifier) {
      type = 'Ghost'; desc.energyWeather = field.energyWeather;
    } else if (field.hasEnergyWeather('Dreamscape') && !holdingNullifier) {
      type = 'Psychic'; desc.energyWeather = field.energyWeather;
    } else if (field.hasEnergyWeather('Dragon Force') && !holdingNullifier) {
      type = 'Dragon'; desc.energyWeather = field.energyWeather;
    } else if (field.hasEnergyWeather('Thunderstorm') && !holdingNullifier) {
      type = 'Electric'; desc.energyWeather = field.energyWeather;
    } else if (field.hasEnergyWeather('Magnetosphere') && !holdingNullifier) {
      type = 'Steel'; desc.energyWeather = field.energyWeather;
    } else if (field.hasClearingWeather('Strong Winds', 'Delta Stream')) {
      type = 'Flying'; desc.clearingWeather = field.clearingWeather;
    } else if (field.hasCataclysmWeather('Ultra Radiance')) {
      type = '???'; desc.cataclysmWeather = field.cataclysmWeather;
    } else if (field.hasClimateWeather('Fog')) {
      type = 'Normal'; desc.climateWeather = field.climateWeather;
    }
    desc.moveType = type;
  } else if (move.named('Judgment') && attacker.item && attacker.item.includes('Plate')) {
    type = getItemBoostType(attacker.item)!;
  } else if (move.originalName === 'Techno Blast' &&
    attacker.item && attacker.item.includes('Drive')) {
    type = getTechnoBlast(attacker.item)!;
    desc.moveType = type;
  } else if (move.originalName === 'Multi-Attack' &&
    attacker.item && attacker.item.includes('Memory')) {
    type = getMultiAttack(attacker.item)!;
    desc.moveType = type;
  } else if (move.named('Natural Gift') && attacker.item?.endsWith('Berry')) {
    const gift = getNaturalGift(gen, attacker.item)!;
    type = gift.t;
    desc.moveType = type;
    desc.attackerItem = attacker.item;
  } else if (
    move.named('Nature Power') ||
    (move.originalName === 'Terrain Pulse' && isGrounded(attacker, field))
  ) {
    type =
      field.hasTerrain('Electric') ? 'Electric'
      : field.hasTerrain('Grassy') ? 'Grass'
      : field.hasTerrain('Misty') ? 'Fairy'
      : field.hasTerrain('Psychic') ? 'Psychic'
      : 'Normal';
    desc.terrain = field.terrain;

    if (move.isMax) {
      desc.moveType = type;
    }

    // If the Nature Power user has the ability Prankster, it cannot affect
    // Dark-types or grounded foes if Psychic Terrain is active
    if (!(move.named('Nature Power') && attacker.hasAbility('Prankster')) &&
      ((defender.types.includes('Dark') ||
      (field.hasTerrain('Psychic') && isGrounded(defender, field))))) {
      desc.moveType = type;
    }
  } else if (move.originalName === 'Revelation Dance') {
    if (attacker.teraType) {
      type = attacker.teraType;
    } else if (attacker.types[0] === '???' && attacker.types[1]) {
      type = attacker.types[1];
    } else {
      type = attacker.types[0];
    }
  } else if (move.named('Aura Wheel') && attacker.named('Morpeko-Hangry')) {
    type = 'Dark';
  } else if (move.named('Raging Bull')) {
    if (attacker.named('Tauros')) {
      type = 'Normal';
    } else if (attacker.named('Tauros-Paldea-Aqua')) {
      type = 'Water';
    } else if (attacker.named('Tauros-Paldea-Blaze')) {
      type = 'Fire';
    } else if (attacker.named('Tauros-Paldea-Combat')) {
      type = 'Fighting';
    }

    field.defenderSide.isReflect = false;
    field.defenderSide.isLightScreen = false;
    field.defenderSide.isAuroraVeil = false;
  } else if (move.named('Ivy Cudgel')) {
    if (attacker.named('Ogerpon') || attacker.name.includes('Ogerpon-Teal')) {
      type = 'Grass';
    } else if (attacker.name.includes('Ogerpon-Cornerstone')) {
      type = 'Rock';
    } else if (attacker.name.includes('Ogerpon-Hearthflame')) {
      type = 'Fire';
    } else if (attacker.name.includes('Ogerpon-Wellspring')) {
      type = 'Water';
    }
  } else if (
    move.named('Tera Starstorm') && attacker.name === 'Terapagos-Stellar'
  ) {
    move.target = 'allAdjacentFoes';
    type = 'Stellar';
  } else if (move.named('Brick Break', 'Psychic Fangs')) {
    field.defenderSide.isReflect = false;
    field.defenderSide.isLightScreen = false;
    field.defenderSide.isAuroraVeil = false;
  }

  let hasAteAbilityTypeChange = false;
  let isAerilate = false;
  let isPixilate = false;
  let isRefrigerate = false;
  let isGalvanize = false;
  let isLiquidVoice = false;
  let isNormalize = false;
  let isDragonize = false;
  let isVegetate = false;
  let isIntoxicate = false;
  let isTrumpetWeevil = false;
  const noTypeChange = move.named(
    'Revelation Dance',
    'Judgment',
    'Nature Power',
    'Techno Blast',
    'Multi-Attack',
    'Natural Gift',
    'Weather Ball',
    'Terrain Pulse',
    'Struggle',
  ) || (move.named('Tera Blast') && attacker.teraType);

  if (!move.isZ && !noTypeChange) {
    const normal = type === 'Normal';
    if ((isAerilate = attacker.hasAbility('Aerilate') && normal)) {
      type = 'Flying';
    } else if ((isGalvanize = attacker.hasAbility('Galvanize') && normal)) {
      type = 'Electric';
    } else if ((isLiquidVoice = attacker.hasAbility('Liquid Voice') && !!move.flags.sound)) {
      type = 'Water';
    } else if ((isPixilate = attacker.hasAbility('Pixilate') && normal)) {
      type = 'Fairy';
    } else if ((isRefrigerate = attacker.hasAbility('Refrigerate') && normal)) {
      type = 'Ice';
    } else if ((isNormalize = attacker.hasAbility('Normalize'))) { // Boosts any type
      type = 'Normal';
    } else if ((isDragonize = attacker.hasAbility('Dragonize')) && normal) {
      type = 'Dragon';
    } else if (isVegetate = attacker.hasAbility('Vegetate') && normal) {
      type = 'Grass';
    } else if (isIntoxicate = attacker.hasAbility('Intoxicate') && normal) {
      type = 'Poison';
    } else if (isTrumpetWeevil = attacker.hasAbility('Trumpet Weevil') && !!move.flags.sound) {
      type = 'Bug';
    }
    if (isGalvanize || isPixilate || isRefrigerate || isAerilate || isNormalize || isDragonize || isVegetate || isIntoxicate) {
      desc.attackerAbility = attacker.ability;
      hasAteAbilityTypeChange = true;
    } else if (isLiquidVoice || isTrumpetWeevil) {
      desc.attackerAbility = attacker.ability;
    }
  }

  if (move.named('Tera Blast') && attacker.teraType) {
    type = attacker.teraType;
  }

  move.type = type;

  const isGhostRevealed =
    attacker.hasAbility('Scrappy') || attacker.hasAbility('Mind\'s Eye') ||
      field.defenderSide.isForesight;
  const isRingTarget =
    defender.hasItem('Ring Target') && !defender.hasAbility('Klutz');
  const type1Effectiveness = getMoveEffectiveness(
    gen,
    move,
    defender.types[0],
    isGhostRevealed,
    field.isGravity,
    isRingTarget
  );
  const type2Effectiveness = defender.types[1]
    ? getMoveEffectiveness(
      gen,
      move,
      defender.types[1],
      isGhostRevealed,
      field.isGravity,
      isRingTarget
    )
    : 1;

  let typeEffectiveness = type1Effectiveness * type2Effectiveness;

  if (defender.teraType && defender.teraType !== 'Stellar') {
    typeEffectiveness = getMoveEffectiveness(
      gen,
      move,
      defender.teraType,
      isGhostRevealed,
      field.isGravity,
      isRingTarget
    );
  }

  if (typeEffectiveness === 0 && move.hasType('Ground') &&
    defender.hasItem('Iron Ball') && !defender.hasAbility('Klutz')) {
    typeEffectiveness = 1;
  }

  if (typeEffectiveness === 0 && move.named('Thousand Arrows') && !defender.hasAbility('Warp Mist')) {
    typeEffectiveness = 1;
  }

  if (typeEffectiveness === 0 && move.hasType('Normal') && field.hasClimateWeather('Fog') &&
      !defender.hasAbility('Warp Mist')) {
    typeEffectiveness = 1;
    desc.climateWeather = field.climateWeather;
  }
  if (typeEffectiveness === 0 && move.hasType('Ground') &&
      field.hasIrritantWeather('Dust') && field.isWeatherBoosted &&
      !attacker.hasItem('Safety Goggles') &&
      !defender.hasAbility('Bubble Helm', 'Earth Eater', 'Overcoat', 'Warp Mist')) {
    typeEffectiveness = 1;
    desc.irritantWeather = field.irritantWeather;
  }
  if (typeEffectiveness === 0 && move.hasType('Ghost') &&
      field.hasEnergyWeather('Paranormal Activity') && field.isWeatherBoosted &&
      !attacker.hasItem('Energy Nullifier') && !defender.hasItem('Energy Nullifier') &&
      !defender.hasAbility('Warp Mist')) {
    typeEffectiveness = 1;
    desc.energyWeather = field.energyWeather;
  }

  if (typeEffectiveness === 0) {
    return result;
  }

  if ((move.named('Sky Drop') &&
        (defender.hasType('Flying') || defender.weightkg >= 200 || field.isGravity)) ||
      (move.named('Synchronoise') && !defender.hasType(attacker.types[0]) &&
        (!attacker.types[1] || !defender.hasType(attacker.types[1]))) ||
      (move.named('Dream Eater') &&
        (!(defender.hasStatus('slp') || defender.hasAbility('Comatose')))) ||
      (move.named('Steel Roller') && !field.terrain) ||
      (move.named('Poltergeist') &&
        (!defender.item || (isQPActive(defender, field) && defender.hasItem('Booster Energy'))))
  ) {
    return result;
  }

  if (
    (field.hasClimateWeather('Desolate Land') && move.hasType('Water')) ||
    (field.hasClimateWeather('Primordial Sea') && move.hasType('Fire'))
  ) {
    desc.climateWeather = field.climateWeather;
    return result;
  }

  if (field.hasClearingWeather('Delta Stream') && defender.hasType('Flying') &&
      gen.types.get(toID(move.type))!.effectiveness['Flying']! > 1) {
    typeEffectiveness /= 2;
    desc.clearingWeather = field.clearingWeather;
  }

  if (move.type === 'Stellar') {
    desc.defenderTera = defender.teraType; // always show in this case
    typeEffectiveness = !defender.teraType ? 1 : 2;
  }

  const turn2typeEffectiveness = typeEffectiveness;

  // Tera Shell works only at full HP, but for all hits of multi-hit moves
  if (defender.hasAbility('Tera Shell') &&
      defender.curHP() === defender.maxHP() &&
      (!field.defenderSide.isSR && (!field.defenderSide.spikes || defender.hasType('Flying')) ||
      defender.hasItem('Heavy-Duty Boots'))
  ) {
    typeEffectiveness = 0.5;
    desc.defenderAbility = defender.ability;
  }

  if ((defender.hasAbility('Wonder Guard') && typeEffectiveness <= 1) ||
      (move.hasType('Grass') && defender.hasAbility('Sap Sipper')) ||
      (move.hasType('Fire') && defender.hasAbility('Flash Fire', 'Well-Baked Body')) ||
      (move.hasType('Water') && defender.hasAbility('Dry Skin', 'Storm Drain', 'Water Absorb')) ||
      (move.hasType('Electric') &&
        defender.hasAbility('Lightning Rod', 'Motor Drive', 'Volt Absorb', 'Power Plumage')) ||
      (move.hasType('Ground') &&
        !field.isGravity && !move.named('Thousand Arrows') &&
        !defender.hasItem('Iron Ball') && defender.hasAbility('Levitate', 'Relic Soul') &&
        !(field.hasIrritantWeather('Dust') && field.isWeatherBoosted &&
          !attacker.hasItem('Safety Goggles'))) ||
      (move.flags.bullet && defender.hasAbility('Bulletproof')) ||
      (move.flags.sound && !move.named('Clangorous Soul') && defender.hasAbility('Soundproof')) ||
      (move.priority > 0 && defender.hasAbility('Queenly Majesty', 'Dazzling', 'Armor Tail')) ||
      (move.hasType('Ground') && defender.hasAbility('Earth Eater')) ||
      (move.flags.wind && defender.hasAbility('Wind Rider')) ||
      (move.hasType('Bug') && defender.hasAbility('Flytrap'))
  ) {
    desc.defenderAbility = defender.ability;
    return result;
  }

  if (move.hasType('Ground') && !move.named('Thousand Arrows') &&
      !field.isGravity && defender.hasItem('Air Balloon') &&
      !(field.hasIrritantWeather('Dust') && field.isWeatherBoosted &&
        !attacker.hasItem('Safety Goggles'))) {
    desc.defenderItem = defender.item;
    return result;
  }

  if (move.hasType('Ground') && !move.named('Thousand Arrows') && !isGrounded(defender, field) &&
      field.hasEnergyWeather('Magnetosphere') && !defender.hasItem('Energy Nullifier')) {
    desc.energyWeather = field.energyWeather;
    return result;
  }

  if (move.priority > 0 && field.hasTerrain('Psychic') && isGrounded(defender, field)) {
    desc.terrain = field.terrain;
    return result;
  }

  const weightBasedMove = move.named('Heat Crash', 'Heavy Slam', 'Low Kick', 'Grass Knot');
  if (defender.isDynamaxed && weightBasedMove) {
    return result;
  }

  desc.HPEVs = getStatDescriptionText(gen, defender, 'hp');

  const fixedDamage = handleFixedDamageMoves(attacker, move);
  if (fixedDamage) {
    if (attacker.hasAbility('Parental Bond')) {
      result.damage = [fixedDamage, fixedDamage];
      desc.attackerAbility = attacker.ability;
    } else {
      result.damage = fixedDamage;
    }
    return result;
  }

  if (move.named('Final Gambit')) {
    result.damage = attacker.curHP();
    return result;
  }

  if (move.named('Guardian of Alola')) {
    let zLostHP = Math.floor((defender.curHP() * 3) / 4);
    if (field.defenderSide.isProtected && attacker.item && attacker.item.includes(' Z')) {
      zLostHP = Math.ceil(zLostHP / 4 - 0.5);
    }
    result.damage = zLostHP;
    return result;
  }

  if (move.named('Nature\'s Madness')) {
    const lostHP = field.defenderSide.isProtected ? 0 : Math.floor(defender.curHP() / 2);
    result.damage = lostHP;
    return result;
  }

  if (move.named('Spectral Thief')) {
    let stat: StatID;
    for (stat in defender.boosts) {
      if (defender.boosts[stat] > 0) {
        attacker.boosts[stat] +=
          attacker.hasAbility('Contrary') ? -defender.boosts[stat]! : defender.boosts[stat]!;
        if (attacker.boosts[stat] > 6) attacker.boosts[stat] = 6;
        if (attacker.boosts[stat] < -6) attacker.boosts[stat] = -6;
        attacker.stats[stat] = getModifiedStat(attacker.rawStats[stat]!, attacker.boosts[stat]!);
        defender.boosts[stat] = 0;
        defender.stats[stat] = defender.rawStats[stat];
      }
    }
  }

  if (move.hits > 1) {
    desc.hits = move.hits;
  }

  const turnOrder = attacker.stats.spe > defender.stats.spe ? 'first' : 'last';

  // #endregion
  // #region Base Power

  const basePower = calculateBasePowerSMSSSV(
    gen,
    attacker,
    defender,
    move,
    field,
    hasAteAbilityTypeChange,
    desc
  );
  if (basePower === 0) {
    return result;
  }

  // #endregion
  // #region (Special) Attack
  const attack = calculateAttackSMSSSV(gen, attacker, defender, move, field, desc, isCritical);
  // #endregion

  // #region (Special) Defense

  const defense = calculateDefenseSMSSSV(gen, attacker, defender, move, field, desc, isCritical);
  const hitsPhysical = move.overrideDefensiveStat === 'def' || move.category === 'Physical';
  const defenseStat = hitsPhysical ? 'def' : 'spd';

  // #endregion
  // #region Damage

  const baseDamage = calculateBaseDamageSMSSSV(
    gen,
    attacker,
    defender,
    basePower,
    attack,
    defense,
    move,
    field,
    desc,
    isCritical,
    typeEffectiveness
  );

  // FIXME: this is incorrect, should be move.flags.heal, not move.drain
  if ((attacker.hasAbility('Triage') && move.drain) ||
      (attacker.hasAbility('Gale Wings') &&
       move.hasType('Flying') &&
       (attacker.curHP() === attacker.maxHP() || field.hasClearingWeather('Strong Winds')))) {
    move.priority = 1;
    desc.attackerAbility = attacker.ability;
  }

  if (hasTerrainSeed(defender) &&
    field.hasTerrain(defender.item!.substring(0, defender.item!.indexOf(' ')) as Terrain) &&
    SEED_BOOSTED_STAT[defender.item!] === defenseStat) {
    // Last condition applies so the calc doesn't show a seed where it wouldn't affect the outcome
    // (like Grassy Seed when being hit by a special move)
    desc.defenderItem = defender.item;
  }

  // the random factor is applied between the crit mod and the stab mod, so don't apply anything
  // below this until we're inside the loop
  let preStellarStabMod = getStabMod(attacker, move, desc);
  let stabMod = getStellarStabMod(attacker, move, preStellarStabMod);

  const applyBurn =
    attacker.hasStatus('brn') &&
    move.category === 'Physical' &&
    !attacker.hasAbility('Guts') &&
    !move.named('Facade');
  desc.isBurned = applyBurn;
  const applyFrostbite =
    attacker.hasStatus('fst') &&
    move.category === 'Special';
  desc.isFrostbitten = applyFrostbite;
  const finalMods = calculateFinalModsSMSSSV(
    gen,
    attacker,
    defender,
    move,
    field,
    desc,
    isCritical,
    typeEffectiveness
  );

  let protect = false;
  if (field.defenderSide.isProtected &&
    (attacker.isDynamaxed ||
      attacker.hasAbility('Unseen Fist', 'Piercing Drill') ||
      (attacker.hasAbility('Trained Eye') && field.hasEnergyWeather('Battle Aura') &&
        !attacker.hasItem('Energy Nullifier')) ||
      (move.isZ && attacker.item && attacker.item.includes(' Z')))) {
    protect = true;
    desc.isProtected = true;
  }

  const finalMod = chainMods(finalMods, 41, 131072);

  const isSpread = field.gameType !== 'Singles' &&
     ['allAdjacent', 'allAdjacentFoes'].includes(move.target);

  let childDamage: number[] | undefined;
  if (attacker.hasAbility('Parental Bond') && move.hits === 1 && !isSpread) {
    const child = attacker.clone();
    child.ability = 'Parental Bond (Child)' as AbilityName;
    checkMultihitBoost(gen, child, defender, move, field, desc);
    childDamage = calculateSMSSSV(gen, child, defender, move, field).damage as number[];
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Echolocation') && move.hits === 1 && !isSpread &&
      !!move.flags.sound && move.category !== 'Status') {
    const echo = attacker.clone();
    echo.ability = 'Echolocation (Echo)' as AbilityName;
    checkMultihitBoost(gen, echo, defender, move, field, desc);
    childDamage = calculateSMSSSV(gen, echo, defender, move, field).damage as number[];
    desc.attackerAbility = attacker.ability;
  }

  const damage = [];
  for (let i = 0; i < 16; i++) {
    damage[i] =
      getFinalDamage(baseDamage, i, typeEffectiveness, applyBurn || applyFrostbite, stabMod, finalMod, protect);
  }
  result.damage = childDamage ? [damage, childDamage] : damage;

  if (move.timesUsed! > 1 || move.hits > 1) {
    // store boosts so intermediate boosts don't show.
    const origDefBoost = desc.defenseBoost;
    const origAtkBoost = desc.attackBoost;

    let numAttacks = 1;
    if (move.timesUsed! > 1) {
      desc.moveTurns = `over ${move.timesUsed} turns`;
      numAttacks = move.timesUsed!;
    } else {
      numAttacks = move.hits;
    }
    let usedItems = [false, false];
    const damageMatrix = [damage];
    for (let times = 1; times < numAttacks; times++) {
      usedItems = checkMultihitBoost(gen, attacker, defender, move,
        field, desc, usedItems[0], usedItems[1]);
      const newAttack = calculateAttackSMSSSV(gen, attacker, defender, move,
        field, desc, isCritical);
      const newDefense = calculateDefenseSMSSSV(gen, attacker, defender, move,
        field, desc, isCritical);
      // Check if lost -ate ability. Typing stays the same, only boost is lost
      // Cannot be regained during multihit move and no Normal moves with stat drawbacks
      hasAteAbilityTypeChange = hasAteAbilityTypeChange &&
        attacker.hasAbility(
          'Aerilate', 'Galvanize', 'Pixilate', 'Refrigerate', 'Normalize', 'Dragonize',
          'Vegetate', 'Intoxicate'
        );

      if (move.timesUsed! > 1) {
        // Adaptability does not change between hits of a multihit, only between turns
        preStellarStabMod = getStabMod(attacker, move, desc);
        // Hack to make Tera Shell with multihit moves, but not over multiple turns
        typeEffectiveness = turn2typeEffectiveness;
        // Stellar damage boost applies for 1 turn, but all hits of multihit.
        stabMod = getStellarStabMod(attacker, move, preStellarStabMod, times);
      }

      const newBasePower = calculateBasePowerSMSSSV(
        gen,
        attacker,
        defender,
        move,
        field,
        hasAteAbilityTypeChange,
        desc,
        times + 1
      );
      const newBaseDamage = calculateBaseDamageSMSSSV(
        gen,
        attacker,
        defender,
        newBasePower,
        newAttack,
        newDefense,
        move,
        field,
        desc,
        isCritical,
        typeEffectiveness
      );
      const newFinalMods = calculateFinalModsSMSSSV(
        gen,
        attacker,
        defender,
        move,
        field,
        desc,
        isCritical,
        typeEffectiveness,
        times
      );
      const newFinalMod = chainMods(newFinalMods, 41, 131072);

      const damageArray = [];
      for (let i = 0; i < 16; i++) {
        const newFinalDamage = getFinalDamage(
          newBaseDamage,
          i,
          typeEffectiveness,
          applyBurn || applyFrostbite,
          stabMod,
          newFinalMod,
          protect
        );
        damageArray[i] = newFinalDamage;
      }
      damageMatrix[times] = damageArray;
    }
    result.damage = damageMatrix;
    desc.defenseBoost = origDefBoost;
    desc.attackBoost = origAtkBoost;
  }


  // #endregion

  return result;
}

export function calculateBasePowerSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  hasAteAbilityTypeChange: boolean,
  desc: RawDesc,
  hit = 1,
) {
  const turnOrder = attacker.stats.spe > defender.stats.spe ? 'first' : 'last';

  let basePower: number;

  switch (move.name) {
  case 'Payback':
    basePower = move.bp * (turnOrder === 'last' ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Bolt Beak':
  case 'Fishious Rend':
    basePower = move.bp * (turnOrder !== 'last' ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Pursuit':
    const switching = field.defenderSide.isSwitching === 'out';
    basePower = move.bp * (switching ? 2 : 1);
    if (switching) desc.isSwitching = 'out';
    desc.moveBP = basePower;
    break;
  case 'Electro Ball':
    const r = Math.floor(attacker.stats.spe / defender.stats.spe);
    basePower = r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40;
    if (defender.stats.spe === 0) basePower = 40;
    desc.moveBP = basePower;
    break;
  case 'Gyro Ball':
    basePower = Math.min(150, Math.floor((25 * defender.stats.spe) / attacker.stats.spe) + 1);
    if (attacker.stats.spe === 0) basePower = 1;
    desc.moveBP = basePower;
    break;
  case 'Punishment':
    basePower = Math.min(200, 60 + 20 * countBoosts(gen, defender.boosts));
    desc.moveBP = basePower;
    break;
  case 'Low Kick':
  case 'Grass Knot':
    const w = getWeight(defender, desc, 'defender');
    basePower = w >= 200 ? 120 : w >= 100 ? 100 : w >= 50 ? 80 : w >= 25 ? 60 : w >= 10 ? 40 : 20;
    desc.moveBP = basePower;
    break;
  case 'Hex':
  case 'Infernal Parade':
    // Hex deals double damage to Pokemon with Comatose (ih8ih8sn0w)
    basePower = move.bp * (defender.status || defender.hasAbility('Comatose') ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Barb Barrage':
    basePower = move.bp * (defender.hasStatus('psn', 'tox', 'blt') ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Bitter Malice':
    basePower = move.bp * (defender.hasStatus('frz', 'fst') ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Heavy Slam':
  case 'Heat Crash':
    const wr =
        getWeight(attacker, desc, 'attacker') /
        getWeight(defender, desc, 'defender');
    basePower = wr >= 5 ? 120 : wr >= 4 ? 100 : wr >= 3 ? 80 : wr >= 2 ? 60 : 40;
    desc.moveBP = basePower;
    break;
  case 'Stored Power':
  case 'Power Trip':
    basePower = 20 + 20 * countBoosts(gen, attacker.boosts);
    desc.moveBP = basePower;
    break;
  case 'Acrobatics':
    basePower = move.bp * (attacker.hasItem('Flying Gem') ||
        (!attacker.item ||
          (isQPActive(attacker, field) && attacker.hasItem('Booster Energy'))) ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Assurance':
    basePower = move.bp * (defender.hasAbility('Parental Bond (Child)') ? 2 : 1);
    // NOTE: desc.attackerAbility = 'Parental Bond' will already reflect this boost
    break;
  case 'Wake-Up Slap':
    // Wake-Up Slap deals double damage to Pokemon with Comatose (ih8ih8sn0w)
    basePower = move.bp * (defender.hasStatus('slp') || defender.hasAbility('Comatose') ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Smelling Salts':
    basePower = move.bp * (defender.hasStatus('par') ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Weather Ball': {
    const isMegaSol = attacker.hasAbility('Mega Sol');
    const isWeatherVaneCastform = attacker.hasItem('Weather Vane') && attacker.name.startsWith('Castform-');
    const anyWeather = !!(field.climateWeather || field.irritantWeather || field.energyWeather ||
      field.clearingWeather || field.cataclysmWeather);
    basePower = move.bp * (anyWeather || isMegaSol || isWeatherVaneCastform ? 2 : 1);
    if (field.hasClimateWeather('Sun', 'Desolate Land', 'Rain', 'Primordial Sea') &&
      attacker.hasItem('Utility Umbrella') && !isMegaSol) basePower = move.bp;
    desc.moveBP = basePower;
    break;
  }
  case 'Terrain Pulse':
    basePower = move.bp * (isGrounded(attacker, field) && field.terrain ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Rising Voltage':
    basePower = move.bp * ((isGrounded(defender, field) && field.hasTerrain('Electric')) ? 2 : 1);
    desc.moveBP = basePower;
    break;
  case 'Psyblade':
    basePower = move.bp * (field.hasTerrain('Electric') ? 1.5 : 1);
    if (field.hasTerrain('Electric')) {
      desc.moveBP = basePower;
      desc.terrain = field.terrain;
    }
    break;
  case 'Fling':
    basePower = getFlingPower(attacker.item, gen.num);
    desc.moveBP = basePower;
    desc.attackerItem = attacker.item;
    break;
  case 'Dragon Energy':
  case 'Eruption':
  case 'Water Spout':
    basePower = Math.max(1, Math.floor((150 * attacker.curHP()) / attacker.maxHP()));
    desc.moveBP = basePower;
    break;
  case 'Flail':
  case 'Reversal':
    const p = Math.floor((48 * attacker.curHP()) / attacker.maxHP());
    basePower = p <= 1 ? 200 : p <= 4 ? 150 : p <= 9 ? 100 : p <= 16 ? 80 : p <= 32 ? 40 : 20;
    desc.moveBP = basePower;
    break;
  case 'Natural Gift':
    if (attacker.item?.endsWith('Berry')) {
      const gift = getNaturalGift(gen, attacker.item)!;
      basePower = gift.p;
      desc.attackerItem = attacker.item;
      desc.moveBP = move.bp;
    } else {
      basePower = move.bp;
    }
    break;
  case 'Nature Power':
    move.category = 'Special';
    move.secondaries = true;

    // Nature Power cannot affect Dark-types if it is affected by Prankster
    if (attacker.hasAbility('Prankster') && defender.types.includes('Dark')) {
      basePower = 0;
      desc.moveName = 'Nature Power';
      desc.attackerAbility = 'Prankster';
      break;
    }
    switch (field.terrain) {
    case 'Electric':
      basePower = 90;
      desc.moveName = 'Thunderbolt';
      break;
    case 'Grassy':
      basePower = 90;
      desc.moveName = 'Energy Ball';
      break;
    case 'Misty':
      basePower = 95;
      desc.moveName = 'Moonblast';
      break;
    case 'Psychic':
      // Nature Power does not affect grounded Pokemon if it is affected by
      // Prankster and there is Psychic Terrain active
      if (attacker.hasAbility('Prankster') && isGrounded(defender, field)) {
        basePower = 0;
        desc.attackerAbility = 'Prankster';
      } else {
        basePower = 90;
        desc.moveName = 'Psychic';
      }
      break;
    default:
      basePower = 80;
      desc.moveName = 'Tri Attack';
    }
    break;
  case 'Water Shuriken':
    basePower = attacker.named('Greninja-Ash') && attacker.hasAbility('Battle Bond') ? 20 : 15;
    desc.moveBP = basePower;
    break;
  // Triple Axel's damage increases after each consecutive hit (20, 40, 60)
  case 'Triple Axel':
    basePower = hit * 20;
    desc.moveBP = move.hits === 2 ? 60 : move.hits === 3 ? 120 : 20;
    break;
  // Triple Kick's damage increases after each consecutive hit (10, 20, 30)
  case 'Triple Kick':
    basePower = hit * 10;
    desc.moveBP = move.hits === 2 ? 30 : move.hits === 3 ? 60 : 10;
    break;
  case 'Crush Grip':
  case 'Wring Out':
    basePower = 100 * Math.floor((defender.curHP() * 4096) / defender.maxHP());
    basePower = Math.floor(Math.floor((120 * basePower + 2048 - 1) / 4096) / 100) || 1;
    desc.moveBP = basePower;
    break;
  case 'Hard Press':
    basePower = 100 * Math.floor((defender.curHP() * 4096) / defender.maxHP());
    basePower = Math.floor(Math.floor((100 * basePower + 2048 - 1) / 4096) / 100) || 1;
    desc.moveBP = basePower;
    break;
  case 'Tera Blast':
    basePower = attacker.teraType === 'Stellar' ? 100 : 80;
    desc.moveBP = basePower;
    break;
  default:
    basePower = move.bp;
  }
  if (basePower === 0) {
    return 0;
  }
  if (move.named(
    'Breakneck Blitz', 'Bloom Doom', 'Inferno Overdrive', 'Hydro Vortex', 'Gigavolt Havoc',
    'Subzero Slammer', 'Supersonic Skystrike', 'Savage Spin-Out', 'Acid Downpour', 'Tectonic Rage',
    'Continental Crush', 'All-Out Pummeling', 'Shattered Psyche', 'Never-Ending Nightmare',
    'Devastating Drake', 'Black Hole Eclipse', 'Corkscrew Crash', 'Twinkle Tackle'
  ) || move.isMax) {
    // show z-move power in description
    desc.moveBP = move.bp;
  }
  const bpMods = calculateBPModsSMSSSV(
    gen,
    attacker,
    defender,
    move,
    field,
    desc,
    basePower,
    hasAteAbilityTypeChange,
    turnOrder,
    hit
  );
  basePower = OF16(Math.max(1, pokeRound((basePower * chainMods(bpMods, 41, 2097152)) / 4096)));
  if (
    attacker.teraType &&
    ((move.type === attacker.teraType && attacker.hasType(attacker.teraType)) ||
    (attacker.teraType === 'Stellar' && move.isStellarFirstUse)) &&
    move.hits === 1 && !move.multiaccuracy &&
    move.priority <= 0 && move.bp > 0 &&
    !move.named('Dragon Energy', 'Eruption', 'Water Spout') &&
    basePower < 60 && gen.num >= 9
  ) {
    basePower = 60;
    desc.moveBP = 60;
  }
  return basePower;
}

export function calculateBPModsSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  basePower: number,
  hasAteAbilityTypeChange: boolean,
  turnOrder: string,
  hit: number
) {
  const bpMods = [];

  // Move effects
  const defenderItem = (defender.item && defender.item !== '')
    ? defender.item : defender.disabledItem;
  let resistedKnockOffDamage =
    (!defenderItem || (isQPActive(defender, field) && defenderItem === 'Booster Energy')) ||
    (defender.named('Dialga-Origin') && defenderItem === 'Adamant Crystal') ||
    (defender.named('Palkia-Origin') && defenderItem === 'Lustrous Globe') ||
    // Griseous Core for gen 9, Griseous Orb otherwise
    (defender.name.includes('Giratina-Origin') && defenderItem.includes('Griseous')) ||
    (defender.name.includes('Arceus') && defenderItem.includes('Plate')) ||
    (defender.name.includes('Genesect') && defenderItem.includes('Drive')) ||
    (defender.named('Groudon', 'Groudon-Primal') && defenderItem === 'Red Orb') ||
    (defender.named('Kyogre', 'Kyogre-Primal') && defenderItem === 'Blue Orb') ||
    (defender.name.includes('Silvally') && defenderItem.includes('Memory')) ||
    defenderItem.includes(' Z') ||
    (defender.name.includes('Zacian') && defenderItem === 'Rusted Sword') ||
    (defender.name.includes('Zamazenta') && defenderItem === 'Rusted Shield') ||
    (defender.name.includes('Ogerpon-Cornerstone') && defenderItem === 'Cornerstone Mask') ||
    (defender.name.includes('Ogerpon-Hearthflame') && defenderItem === 'Hearthflame Mask') ||
    (defender.name.includes('Ogerpon-Wellspring') && defenderItem === 'Wellspring Mask') ||
    (defender.named('Venomicon-Epilogue') && defenderItem === 'Vile Vial');

  // The last case only applies when the Pokemon has the Mega Stone that matches its species
  // (or when it's already a Mega-Evolution)
  if (!resistedKnockOffDamage && defenderItem) {
    const item = gen.items.get(toID(defenderItem))!;
    resistedKnockOffDamage = !!(item.megaStone &&
      (item.megaStone[defender.name] || Object.values(item.megaStone).includes(defender.name)));
  }

  // Resist knock off damage if your item was already knocked off
  if (!resistedKnockOffDamage && hit > 1 && !defender.hasAbility('Sticky Hold')) {
    resistedKnockOffDamage = true;
  }

  if ((move.named('Facade') && attacker.hasStatus('brn', 'par', 'psn', 'tox', 'fst', 'blt')) ||
    (move.named('Brine') && defender.curHP() <= defender.maxHP() / 2) ||
    (move.named('Venoshock') && defender.hasStatus('psn', 'tox', 'blt')) ||
    (move.named('Lash Out') && (countBoosts(gen, attacker.boosts) < 0))
  ) {
    bpMods.push(8192);
    desc.moveBP = basePower * 2;
  } else if (
    move.named('Expanding Force') && isGrounded(attacker, field) && field.hasTerrain('Psychic')
  ) {
    move.target = 'allAdjacentFoes';
    bpMods.push(6144);
    desc.moveBP = basePower * 1.5;
  } else if ((move.named('Knock Off') && !resistedKnockOffDamage) ||
    (move.named('Misty Explosion') && isGrounded(attacker, field) && field.hasTerrain('Misty')) ||
    (move.named('Grav Apple') && field.isGravity)
  ) {
    bpMods.push(6144);
    desc.moveBP = basePower * 1.5;
  } else if (move.named('Solar Beam', 'Solar Blade') &&
      ((field.hasClimateWeather('Rain', 'Primordial Sea', 'Hail', 'Snow') && !attacker.hasItem('Utility Umbrella')) ||
       (field.hasIrritantWeather('Sand') && !attacker.hasItem('Safety Goggles')))) {
    bpMods.push(2048);
    desc.moveBP = basePower / 2;
    if (field.climateWeather) desc.climateWeather = field.climateWeather; else desc.irritantWeather = field.irritantWeather;
  } else if (move.named('Collision Course', 'Electro Drift')) {
    const isGhostRevealed =
      attacker.hasAbility('Scrappy') || attacker.hasAbility('Mind\'s Eye') ||
      field.defenderSide.isForesight;
    const isRingTarget =
      defender.hasItem('Ring Target') && !defender.hasAbility('Klutz');
    const types = defender.teraType && defender.teraType !== 'Stellar'
      ? [defender.teraType] : defender.types;
    const type1Effectiveness = getMoveEffectiveness(
      gen,
      move,
      types[0],
      isGhostRevealed,
      field.isGravity,
      isRingTarget
    );
    const type2Effectiveness = types[1] ? getMoveEffectiveness(
      gen,
      move,
      types[1],
      isGhostRevealed,
      field.isGravity,
      isRingTarget
    ) : 1;
    if (type1Effectiveness * type2Effectiveness >= 2) {
      bpMods.push(5461);
      desc.moveBP = basePower * (5461 / 4096);
    }
  } else if (move.named('Sandblast') && field.hasIrritantWeather('Sand', 'Dust')) {
    bpMods.push(8192);
    desc.irritantWeather = field.irritantWeather;
  } else if (move.named('Conduction') && field.hasEnergyWeather('Magnetosphere')) {
    bpMods.push(6144);
    desc.energyWeather = field.energyWeather;
  } else if (move.named('Shade') && field.hasClimateWeather('Blood Moon')) {
    bpMods.push(8192);
    desc.climateWeather = field.climateWeather;
  } else if (move.named('Deception')) {
    const inBloodMoon = field.hasClimateWeather('Blood Moon');
    const inSprinkle = field.hasIrritantWeather('Fairy Dust');
    if (inBloodMoon && !inSprinkle) {
      bpMods.push(5120);
      desc.climateWeather = field.climateWeather;
    } else if (!inBloodMoon && inSprinkle) {
      bpMods.push(2048);
      desc.irritantWeather = field.irritantWeather;
    }
  } else if (move.named('Slushball') &&
      field.hasClimateWeather('Rain', 'Primordial Sea', 'Hail', 'Snow')) {
    bpMods.push(6144);
    desc.climateWeather = field.climateWeather;
  }

  if (field.attackerSide.isHelpingHand) {
    bpMods.push(6144);
    desc.isHelpingHand = true;
  }

  // Field effects

  const terrainMultiplier = gen.num > 7 ? 5325 : 6144;
  if (isGrounded(attacker, field)) {
    if ((field.hasTerrain('Electric') && move.hasType('Electric')) ||
        (field.hasTerrain('Grassy') && move.hasType('Grass')) ||
        (field.hasTerrain('Psychic') && move.hasType('Psychic'))
    ) {
      bpMods.push(terrainMultiplier);
      desc.terrain = field.terrain;
    }
  }
  if (isGrounded(defender, field)) {
    if ((field.hasTerrain('Misty') && move.hasType('Dragon')) ||
        (field.hasTerrain('Grassy') && move.named('Bulldoze', 'Earthquake'))
    ) {
      bpMods.push(2048);
      desc.terrain = field.terrain;
    }
  }

  // Abilities

  // Use BasePower after moves with custom BP to determine if Technician should boost
  if ((attacker.hasAbility('Technician') && basePower <= 60) ||
    (attacker.hasAbility('Flare Boost') &&
      attacker.hasStatus('brn') && move.category === 'Special') ||
    (attacker.hasAbility('Toxic Boost') &&
      attacker.hasStatus('psn', 'tox', 'blt') && move.category === 'Physical') ||
    (attacker.hasAbility('Mega Launcher') && move.flags.pulse) ||
    (attacker.hasAbility('Strong Jaw') && move.flags.bite) ||
    (attacker.hasAbility('Steely Spirit') && move.hasType('Steel')) ||
    (attacker.hasAbility('Sharpness') && move.flags.slicing)
  ) {
    bpMods.push(6144);
    desc.attackerAbility = attacker.ability;
  }

  const aura = `${move.type} Aura`;
  const isAttackerAura = attacker.hasAbility(aura);
  const isDefenderAura = defender.hasAbility(aura);
  const isUserAuraBreak = attacker.hasAbility('Aura Break') || defender.hasAbility('Aura Break');
  const isFieldAuraBreak = field.isAuraBreak;
  const isFieldFairyAura = field.isFairyAura && move.type === 'Fairy';
  const isFieldDarkAura = field.isDarkAura && move.type === 'Dark';
  const auraActive = isAttackerAura || isDefenderAura || isFieldFairyAura || isFieldDarkAura;
  const auraBreak = isFieldAuraBreak || isUserAuraBreak;
  if (auraActive) {
    if (auraBreak) {
      bpMods.push(3072);
      desc.attackerAbility = attacker.ability;
      desc.defenderAbility = defender.ability;
    } else {
      bpMods.push(5448);
      if (isAttackerAura) desc.attackerAbility = attacker.ability;
      if (isDefenderAura) desc.defenderAbility = defender.ability;
    }
  }

  // Sheer Force does not power up max moves or remove the effects (SadisticMystic)
  if (
    (attacker.hasAbility('Sheer Force') &&
      (move.secondaries || move.named('Electro Shot', 'Order Up')) && !move.isMax) ||
    (attacker.hasAbility('Absolute Zero') &&
      field.hasClimateWeather('Snow', 'Hail') && !attacker.hasItem('Utility Umbrella') && move.hasType('Ice')) ||
    (attacker.hasAbility('Earth Force') &&
      field.hasIrritantWeather('Sand', 'Dust') && !attacker.hasItem('Safety Goggles') && move.hasType('Rock', 'Ground', 'Steel')) ||
    (attacker.hasAbility('Power Above') &&
      field.hasIrritantWeather('Fairy Dust') && !attacker.hasItem('Safety Goggles') && move.hasType('Fairy', 'Grass', 'Fire', 'Water')) ||
    (attacker.hasAbility('Power Below') &&
      field.hasEnergyWeather('Dragon Force') && !attacker.hasItem('Energy Nullifier') && move.hasType('Dragon', 'Fire', 'Electric', 'Ice')) ||
    (attacker.hasAbility('Analytic') &&
      (turnOrder !== 'first' || field.defenderSide.isSwitching === 'out')) ||
    (attacker.hasAbility('Tough Claws') && move.flags.contact) ||
    (attacker.hasAbility('Punk Rock') && move.flags.sound)
  ) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
  }
  if (
    (attacker.hasAbility('Carbon Capture') &&
      field.hasIrritantWeather('Smog') && !attacker.hasItem('Safety Goggles') && move.hasType('Poison'))
  ) {
    bpMods.push(8192);
    desc.attackerAbility = attacker.ability;
  }
  if (
    (attacker.hasAbility('Smoke and Mirrors') &&
      field.hasEnergyWeather('Dreamscape') && !attacker.hasItem('Energy Nullifier') && move.category === 'Special')
  ) {
    bpMods.push(4195);
    desc.attackerAbility = attacker.ability;
  }

  if (field.attackerSide.isBattery && move.category === 'Special') {
    bpMods.push(5325);
    desc.isBattery = true;
  }

  if (field.attackerSide.isPowerSpot) {
    bpMods.push(5325);
    desc.isPowerSpot = true;
  }

  if (attacker.hasAbility('Rivalry') && ![attacker.gender, defender.gender].includes('N')) {
    if (attacker.gender === defender.gender) {
      bpMods.push(5120);
      desc.rivalry = 'buffed';
    } else {
      bpMods.push(3072);
      desc.rivalry = 'nerfed';
    }
    desc.attackerAbility = attacker.ability;
  }

  // The -ate abilities already changed move typing earlier, so most checks are done and desc is set
  // However, Max Moves also don't boost -ate Abilities
  if (!move.isMax && hasAteAbilityTypeChange) {
    bpMods.push(4915);
  }

  if (attacker.hasAbility('Reckless') && (move.recoil || move.hasCrashDamage)) {
    bpMods.push(4915);
    desc.attackerAbility = attacker.ability;
  }
  if (attacker.hasAbility('Iron Fist') && move.flags.punch ||
    attacker.hasAbility('Trumpet Weevil') && move.flags.sound
  ) {
    bpMods.push(6144);
    desc.attackerAbility = attacker.ability;
  }
  if (attacker.hasAbility('Chakra') && move.hasType('Fairy')) {
    bpMods.push(5325);
    desc.attackerAbility = attacker.ability;
  }

  if (gen.num <= 8 && defender.hasAbility('Heatproof') && move.hasType('Fire')) {
    bpMods.push(2048);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Dry Skin') && move.hasType('Fire')) {
    bpMods.push(5120);
    desc.defenderAbility = defender.ability;
  }

  if (attacker.hasAbility('Supreme Overlord') && attacker.alliesFainted) {
    const powMod = [4096, 4506, 4915, 5325, 5734, 6144];
    bpMods.push(powMod[Math.min(5, attacker.alliesFainted)]);
    desc.attackerAbility = attacker.ability;
    desc.alliesFainted = attacker.alliesFainted;
  }

  // Items

  if (attacker.hasItem(`${move.type} Gem`)) {
    bpMods.push(5325);
    desc.attackerItem = attacker.item;
  } else if (
    (((attacker.hasItem('Adamant Crystal') && attacker.named('Dialga-Origin')) ||
      (attacker.hasItem('Adamant Orb') && attacker.named('Dialga'))) &&
     move.hasType('Steel', 'Dragon')) ||
    (((attacker.hasItem('Lustrous Orb') &&
     attacker.named('Palkia')) ||
      (attacker.hasItem('Lustrous Globe') && attacker.named('Palkia-Origin'))) &&
     move.hasType('Water', 'Dragon')) ||
    (((attacker.hasItem('Griseous Orb') || attacker.hasItem('Griseous Core')) &&
     (attacker.named('Giratina-Origin') || attacker.named('Giratina'))) &&
     move.hasType('Ghost', 'Dragon')) ||
    (attacker.hasItem('Vile Vial') &&
     attacker.named('Venomicon-Epilogue') &&
     move.hasType('Poison', 'Flying')) ||
    (attacker.hasItem('Soul Dew') &&
     attacker.named('Latios', 'Latias', 'Latios-Mega', 'Latias-Mega') &&
     move.hasType('Psychic', 'Dragon')) ||
    (attacker.name.includes('Ogerpon-Cornerstone') && attacker.hasItem('Cornerstone Mask')) ||
    (attacker.name.includes('Ogerpon-Hearthflame') && attacker.hasItem('Hearthflame Mask')) ||
    (attacker.name.includes('Ogerpon-Wellspring') && attacker.hasItem('Wellspring Mask'))
  ) {
    bpMods.push(4915);
    desc.attackerItem = attacker.item;
  } else if (attacker.item && move.hasType(getItemBoostType(attacker.item))) {
    bpMods.push(attacker.item.includes('Plate') ? 5325 : 4915);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Muscle Band') && move.category === 'Physical') ||
    (attacker.hasItem('Wise Glasses') && move.category === 'Special')
  ) {
    bpMods.push(4505);
    desc.attackerItem = attacker.item;
  } else if (attacker.hasItem('Punching Glove') && move.flags.punch) {
    bpMods.push(4506);
  }
  return bpMods;
}

export function calculateAttackSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {
  let attack: number;
  const attackSource = move.named('Foul Play') ? defender : attacker;
  const attackStat =
    move.named('Body Press')
      ? (field.isWonderRoom ? 'spd' : 'def')
      : (move.category === 'Special' ? 'spa' : 'atk');
  // Body Press in Wonder Room uses normal Def, which checkRawStatChanges has moved to SpD
  desc.attackEVs =
    move.named('Foul Play')
      ? getStatDescriptionText(
        gen, attackSource, attackStat, field.defenderSide.isPowerTrick
      )
      : getStatDescriptionText(
        gen, attackSource, attackStat, field.attackerSide.isPowerTrick, field.isWonderRoom
      );
  if (field.attackerSide.isPowerTrick) {
    if ((move.category === 'Physical' && !move.named('Foul Play')) || move.named('Body Press')) {
      desc.isPowerTrickAttacker = true;
    }
  }
  const boosts = attackSource.boosts[attackStat];
  if (boosts === 0 || (isCritical && boosts < 0)) {
    attack = attackSource.rawStats[attackStat];
  } else if (defender.hasAbility('Unaware')) {
    attack = attackSource.rawStats[attackStat];
    desc.defenderAbility = defender.ability;
  } else {
    attack = getModifiedStat(attackSource.rawStats[attackStat]!, boosts);
    desc.attackBoost = boosts;
  }

  // unlike all other attack modifiers, Hustle gets applied directly
  if (attacker.hasAbility('Hustle') && move.category === 'Physical') {
    attack = pokeRound((attack * 3) / 2);
    desc.attackerAbility = attacker.ability;
  }
  const atMods = calculateAtModsSMSSSV(gen, attacker, defender, move, field, desc);
  attack = OF16(Math.max(1, pokeRound((attack * chainMods(atMods, 410, 131072)) / 4096)));
  return attack;
}

export function calculateAtModsSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc
) {
  const atMods = [];

  // Slow Start also halves damage with special Z-moves
  if ((attacker.hasAbility('Slow Start') && attacker.abilityOn &&
       (move.category === 'Physical' || (move.category === 'Special' && move.isZ))) ||
      (attacker.hasAbility('Defeatist') && attacker.curHP() <= attacker.maxHP() / 2)
  ) {
    atMods.push(2048);
    desc.attackerAbility = attacker.ability;
  } else if (
    (attacker.hasAbility('Solar Power') &&
     field.hasClimateWeather('Sun', 'Desolate Land')) ||
    (attacker.hasAbility('Malice') &&
     field.hasClimateWeather('Blood Moon')) ||
    (attacker.named('Cherrim', 'Cherrim-Sunshine') &&
     attacker.hasAbility('Flower Gift') &&
     field.hasClimateWeather('Sun', 'Desolate Land') &&
     move.category === 'Physical')) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.climateWeather = field.climateWeather;
  } else if (
    (attacker.hasAbility('Rage State') &&
     field.hasEnergyWeather('Battle Aura'))) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
    desc.energyWeather = field.energyWeather;
  } else if (
    // Gorilla Tactics has no effect during Dynamax (Anubis)
    (attacker.hasAbility('Gorilla Tactics') && move.category === 'Physical' &&
     !attacker.isDynamaxed)) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (
    (attacker.hasAbility('Guts') && attacker.status && move.category === 'Physical') ||
    (attacker.curHP() <= attacker.maxHP() / 3 &&
      ((attacker.hasAbility('Overgrow') && move.hasType('Grass')) ||
       (attacker.hasAbility('Blaze') && move.hasType('Fire')) ||
       (attacker.hasAbility('Torrent') && move.hasType('Water')))) ||
    (attacker.hasAbility('Swarm') && move.hasType('Bug') &&
      (attacker.curHP() <= attacker.maxHP() / 3 || field.hasIrritantWeather('Pheromones'))) ||
    (move.category === 'Special' && attacker.abilityOn && attacker.hasAbility('Plus', 'Minus'))
  ) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Flash Fire') && attacker.abilityOn && move.hasType('Fire')) {
    atMods.push(6144);
    desc.attackerAbility = 'Flash Fire';
  } else if (
    (attacker.hasAbility('Steelworker') && move.hasType('Steel')) ||
    (attacker.hasAbility('Dragon\'s Maw') && move.hasType('Dragon')) ||
    (attacker.hasAbility('Rocky Payload') && move.hasType('Rock')) ||
    (attacker.hasAbility('Fieldworker') && move.hasType('Grass'))
  ) {
    atMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Transistor') && move.hasType('Electric')) {
    atMods.push(gen.num >= 9 ? 5325 : 6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Stakeout') && attacker.abilityOn) {
    atMods.push(8192);
    desc.attackerAbility = attacker.ability;
  } else if (
    (attacker.hasAbility('Water Bubble') && move.hasType('Water')) ||
    (attacker.hasAbility('Huge Power', 'Pure Power') && move.category === 'Physical')
  ) {
    atMods.push(8192);
    desc.attackerAbility = attacker.ability;
  }

  if (
    field.attackerSide.isFlowerGift &&
    !attacker.hasAbility('Flower Gift') &&
    field.hasClimateWeather('Sun', 'Desolate Land') &&
    move.category === 'Physical') {
    atMods.push(6144);
    desc.climateWeather = field.climateWeather;
    desc.isFlowerGiftAttacker = true;
  }

  if (
    field.attackerSide.isSteelySpirit &&
    move.hasType('Steel')
  ) {
    atMods.push(6144);
    desc.isSteelySpiritAttacker = true;
  }

  if ((defender.hasAbility('Thick Fat') && move.hasType('Fire', 'Ice')) ||
      (defender.hasAbility('Water Bubble') && move.hasType('Fire')) ||
      (defender.hasAbility('Purifying Salt') && move.hasType('Ghost')) ||
      (defender.hasAbility('Hydrophobic') && move.hasType('Fire')) ||
      (defender.hasAbility('Foil') && move.hasType('Psychic'))) {
    atMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if (gen.num >= 9 && defender.hasAbility('Heatproof') && move.hasType('Fire')) {
    atMods.push(2048);
    desc.defenderAbility = defender.ability;
  }
  // Pokemon with "-of Ruin" Ability are immune to the opposing "-of Ruin" ability
  const isTabletsOfRuinActive = (defender.hasAbility('Tablets of Ruin') || field.isTabletsOfRuin) &&
    !attacker.hasAbility('Tablets of Ruin');
  const isVesselOfRuinActive = (defender.hasAbility('Vessel of Ruin') || field.isVesselOfRuin) &&
    !attacker.hasAbility('Vessel of Ruin');
  if (
    (isTabletsOfRuinActive && move.category === 'Physical') ||
    (isVesselOfRuinActive && move.category === 'Special')
  ) {
    if (defender.hasAbility('Tablets of Ruin') || defender.hasAbility('Vessel of Ruin')) {
      desc.defenderAbility = defender.ability;
    } else {
      desc[move.category === 'Special' ? 'isVesselOfRuin' : 'isTabletsOfRuin'] = true;
    }
    atMods.push(3072);
  }

  if (isQPActive(attacker, field)) {
    if (
      (move.category === 'Physical' && getQPBoostedStat(attacker) === 'atk') ||
      (move.category === 'Special' && getQPBoostedStat(attacker) === 'spa')
    ) {
      atMods.push(5325);
      desc.attackerAbility = attacker.ability;
    }
  }

  if (
    (attacker.hasAbility('Hadron Engine') && move.category === 'Special' &&
      field.hasTerrain('Electric')) ||
    (attacker.hasAbility('Orichalcum Pulse') && move.category === 'Physical' &&
      field.hasClimateWeather('Sun', 'Desolate Land') && !attacker.hasItem('Utility Umbrella'))
  ) {
    atMods.push(5461);
    desc.attackerAbility = attacker.ability;
  }

  if ((attacker.hasItem('Thick Club') &&
       attacker.named('Cubone', 'Marowak', 'Marowak-Alola', 'Marowak-Alola-Totem') &&
       move.category === 'Physical') ||
      (attacker.hasItem('Deep Sea Tooth') &&
       attacker.named('Clamperl') &&
       move.category === 'Special') ||
      (attacker.hasItem('Light Ball') &&
       (attacker.name.includes('Pikachu') || attacker.name.includes('Pichu')) && !move.isZ)
  ) {
    atMods.push(8192);
    desc.attackerItem = attacker.item;
  } else if (
    (attacker.hasItem('Thick Club') &&
     attacker.named('Oracub', 'Bearvoyance') && move.category === 'Special') ||
    (attacker.hasItem('Light Ball') &&
     (attacker.name.includes('Raichu') || attacker.name.includes('Emolga') ||
      attacker.name.includes('Guruchi')) && !move.isZ)
  ) {
    atMods.push(6144);
    desc.attackerItem = attacker.item;
    // Choice Band/Scarf/Specs move lock and stat boosts are ignored during Dynamax (Anubis)
  } else if (!move.isZ && !move.isMax &&
    ((attacker.hasItem('Choice Band') && move.category === 'Physical') ||
      (attacker.hasItem('Choice Specs') && move.category === 'Special'))
  ) {
    atMods.push(6144);
    desc.attackerItem = attacker.item;
  }
  if (field.hasIrritantWeather('Pollen') &&
      !attacker.hasType('Grass', 'Bug') &&
      !attacker.hasAbility('Arena Bloom', 'Bloomspring') &&
      !attacker.hasItem('Safety Goggles')
    ) {
    atMods.push(3072);
    desc.irritantWeather = field.irritantWeather;
  }
  if (field.hasEnergyWeather('Magnetosphere') &&
      attacker.hasType('Steel') && 
      attacker.magnetizeBoosts > 0 &&
      !attacker.hasItem('Energy Nullifier')
    ) {
    const stacks = Math.min(attacker.magnetizeBoosts, 8);
    atMods.push(Math.round(4096 * (1 + 0.2 * stacks)));
    desc.energyWeather = field.energyWeather;
  }

  return atMods;
}

export function calculateDefenseSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false
) {
  let defense: number;
  const hitsPhysical = move.overrideDefensiveStat === 'def' || move.category === 'Physical';
  const defenseStat = hitsPhysical ? 'def' : 'spd';
  desc.defenseEVs = getStatDescriptionText(
    gen, defender, defenseStat, field.defenderSide.isPowerTrick, field.isWonderRoom
  );
  if (field.defenderSide.isPowerTrick && (field.isWonderRoom !== hitsPhysical)) {
    desc.isPowerTrickDefender = true;
  }

  const boosts = defender.boosts[defenseStat];
  if (boosts === 0 ||
      (isCritical && boosts > 0) ||
      move.ignoreDefensive) {
    defense = defender.rawStats[defenseStat];
  } else if (attacker.hasAbility('Unaware') || move.name === 'Nihil Light') {
    defense = defender.rawStats[defenseStat];
    desc.attackerAbility = attacker.ability;
  } else {
    defense = getModifiedStat(defender.rawStats[defenseStat]!, boosts);
    desc.defenseBoost = boosts;
  }

  // unlike all other defense modifiers, weather defense boosts get applied directly
  if (field.hasClimateWeather('Snow') && defender.hasType('Ice') && !defender.hasItem('Utility Umbrella')) {
    if (hitsPhysical) {
      defense = pokeRound((defense * 3) / 2);
      desc.climateWeather = field.climateWeather;
    } else if (field.isWeatherBoosted) {
      defense = pokeRound((defense * 3) / 2);
      desc.climateWeather = field.climateWeather;
    }
  }
  if (field.hasIrritantWeather('Sand') && !defender.hasItem('Safety Goggles')) {
    if (defender.hasType('Rock') && !hitsPhysical) {
      defense = pokeRound((defense * 3) / 2);
      desc.irritantWeather = field.irritantWeather;
    }
    if (field.isWeatherBoosted) {
      if (defender.hasType('Rock') && hitsPhysical) {
        defense = pokeRound((defense * 3) / 2);
        desc.irritantWeather = field.irritantWeather;
      }
      if ((defender.hasType('Ground') || defender.hasType('Steel')) && !hitsPhysical) {
        defense = pokeRound((defense * 3) / 2);
        desc.irritantWeather = field.irritantWeather;
      }
    }
  } else if (field.hasIrritantWeather('Fairy Dust') && defender.hasType('Fairy') && !defender.hasItem('Safety Goggles') && !hitsPhysical) {
    defense = pokeRound((defense * 5) / 4);
    desc.irritantWeather = field.irritantWeather;
  }

  const dfMods = calculateDfModsSMSSSV(
    gen,
    attacker,
    defender,
    move,
    field,
    desc,
    isCritical,
    hitsPhysical
  );

  return OF16(Math.max(1, pokeRound((defense * chainMods(dfMods, 410, 131072)) / 4096)));
}

export function calculateDfModsSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false,
  hitsPhysical = false
) {
  const dfMods = [];
  if (defender.hasAbility('Marvel Scale') && defender.status && hitsPhysical) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
  } else if (
    defender.named('Cherrim', 'Cherrim-Sunshine') &&
    defender.hasAbility('Flower Gift') &&
    field.hasClimateWeather('Sun', 'Desolate Land') &&
    !hitsPhysical
  ) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
    desc.climateWeather = field.climateWeather;
  } else if (
    field.defenderSide.isFlowerGift &&
    field.hasClimateWeather('Sun', 'Desolate Land') &&
    !hitsPhysical) {
    dfMods.push(6144);
    desc.climateWeather = field.climateWeather;
    desc.isFlowerGiftDefender = true;
  } else if (
    defender.hasAbility('Grass Pelt') &&
    (field.hasTerrain('Grassy') || field.hasIrritantWeather('Pollen')) &&
    hitsPhysical
  ) {
    dfMods.push(6144);
    desc.defenderAbility = defender.ability;
  } else if (defender.hasAbility('Fur Coat') && hitsPhysical) {
    dfMods.push(8192);
    desc.defenderAbility = defender.ability;
  }
  if (defender.hasAbility('Glacial Armor') && field.hasClimateWeather('Hail', 'Snow')) {
    dfMods.push(4915);
    desc.defenderAbility = defender.ability;
    desc.climateWeather = field.climateWeather;
  }
  // Pokemon with "-of Ruin" Ability are immune to the opposing "-of Ruin" ability
  const isSwordOfRuinActive = (attacker.hasAbility('Sword of Ruin') || field.isSwordOfRuin) &&
    !defender.hasAbility('Sword of Ruin');
  const isBeadsOfRuinActive = (attacker.hasAbility('Beads of Ruin') || field.isBeadsOfRuin) &&
    !defender.hasAbility('Beads of Ruin');
  if (
    (isSwordOfRuinActive && hitsPhysical) ||
    (isBeadsOfRuinActive && !hitsPhysical)
  ) {
    if (attacker.hasAbility('Sword of Ruin') || attacker.hasAbility('Beads of Ruin')) {
      desc.attackerAbility = attacker.ability;
    } else {
      desc[hitsPhysical ? 'isSwordOfRuin' : 'isBeadsOfRuin'] = true;
    }
    dfMods.push(3072);
  }

  if (isQPActive(defender, field)) {
    if (
      (hitsPhysical && getQPBoostedStat(defender) === 'def') ||
      (!hitsPhysical && getQPBoostedStat(defender) === 'spd')
    ) {
      desc.defenderAbility = defender.ability;
      dfMods.push(5324);
    }
  }

  if ((defender.hasItem('Eviolite') &&
      (defender.name === 'Dipplin' || gen.species.get(toID(defender.name))?.nfe)) ||
      (!hitsPhysical && defender.hasItem('Assault Vest'))) {
    dfMods.push(6144);
    desc.defenderItem = defender.item;
  } else if (
    (defender.hasItem('Metal Powder') && defender.named('Ditto') && hitsPhysical) ||
    (defender.hasItem('Deep Sea Scale') && defender.named('Clamperl') && !hitsPhysical)
  ) {
    dfMods.push(8192);
    desc.defenderItem = defender.item;
  }
  return dfMods;
}

function calculateBaseDamageSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  basePower: number,
  attack: number,
  defense: number,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false,
  typeEffectiveness: number,
) {
  let baseDamage = getBaseDamage(attacker.level, basePower, attack, defense);
  const isSpread = field.gameType !== 'Singles' &&
     ['allAdjacent', 'allAdjacentFoes'].includes(move.target);
  if (isSpread) {
    baseDamage = pokeRound(OF32(baseDamage * 3072) / 4096);
  }

  if (attacker.hasAbility('Parental Bond (Child)', 'Echolocation (Echo)')) {
    baseDamage = pokeRound(OF32(baseDamage * 1024) / 4096);
  }

  const isMegaSol = attacker.hasAbility('Mega Sol');
  if (
    (field.hasClimateWeather('Sun') || isMegaSol) &&
      move.named('Hydro Steam') &&
      !attacker.hasItem('Utility Umbrella')
  ) {
    baseDamage = pokeRound(OF32(baseDamage * 6144) / 4096);
    isMegaSol ? desc.attackerAbility = attacker.ability : desc.climateWeather = field.climateWeather;
  } else if (!defender.hasItem('Utility Umbrella')) {
    if (
      ((field.hasClimateWeather('Sun', 'Desolate Land') || isMegaSol) && move.hasType('Fire') &&
        !defender.hasAbility('Droughtproof')) ||
      ((field.hasClimateWeather('Rain', 'Primordial Sea') && !isMegaSol) && move.hasType('Water') &&
        !attacker.hasAbility('Droughtproof') && !defender.hasAbility('Hydrophobic'))
    ) {
      baseDamage = pokeRound(OF32(baseDamage * (field.isWeatherBoosted ? 6554 : 6144)) / 4096);
      isMegaSol ? desc.attackerAbility = attacker.ability : desc.climateWeather = field.climateWeather;
    } else if (
      (((field.hasClimateWeather('Sun') || isMegaSol) && move.hasType('Water')) ||
      (field.hasClimateWeather('Rain') && move.hasType('Fire'))) &&
      !defender.hasAbility('Droughtproof')
    ) {
      baseDamage = pokeRound(OF32(baseDamage * (field.isWeatherBoosted ? 1638 : 2048)) / 4096);
      isMegaSol ? desc.attackerAbility = attacker.ability : desc.climateWeather = field.climateWeather;
    } else if (field.hasClimateWeather('Blood Moon') && move.hasType('Fairy')) {
      baseDamage = pokeRound(OF32(baseDamage * 2048) / 4096);
      desc.climateWeather = field.climateWeather;
    } else if (field.hasClimateWeather('Fog') && field.isWeatherBoosted && move.hasType('Normal')) {
      baseDamage = pokeRound(OF32(baseDamage * 6144) / 4096);
      desc.climateWeather = field.climateWeather;
    }
  } else if (!defender.hasItem('Safety Goggles')) {
    if (
      field.hasIrritantWeather('Dust') && move.hasType('Grass', 'Water') &&
      !attacker.hasAbility('Earth Force')
    ) {
      baseDamage = pokeRound(OF32(baseDamage * 2048) / 4096);
      desc.irritantWeather = field.irritantWeather;
    }
  } else if (!defender.hasItem('Energy Nullifier')) {
    if (
      ((field.hasEnergyWeather('Dreamscape')) && move.hasType('Psychic'))
    ) {
      baseDamage = pokeRound(OF32(baseDamage * 6144) / 4096);
      desc.energyWeather = field.energyWeather;
    } else if (
      ((field.hasEnergyWeather('Dreamscape')) && move.hasType('Dark'))
    ) {
      baseDamage = pokeRound(OF32(baseDamage * 2048) / 4096);
      desc.energyWeather = field.energyWeather;
    } else if (
      field.hasEnergyWeather('Dragon Force') && move.hasType('Dragon')
    ) {
      baseDamage = pokeRound(OF32(baseDamage * (field.isWeatherBoosted ? 6144 : 5120)) / 4096);
      desc.energyWeather = field.energyWeather;
    } else if (
      field.hasEnergyWeather('Dragon Force') && typeEffectiveness > 1) {
      baseDamage = pokeRound(OF32(baseDamage * 3277) / 4096);
      desc.energyWeather = field.energyWeather;
    }
  } else if (field.hasCataclysmWeather('Ultra Radiance')) {
    const ULTRA_BEASTS = new Set([
      'Nihilego', 'Buzzwole', 'Pheromosa', 'Xurkitree', 'Celesteela', 'Kartana', 'Guzzlord', 'Poipole', 'Naganadel', 'Stakataka', 'Blacephalon',
      'Orbtholod', 'Pestalation', 'Revylon', 'Leoseace', 'Lamentu', 'Endram-Odai',
    ]);
    if (ULTRA_BEASTS.has(attacker.name)) {
      baseDamage = pokeRound(OF32(baseDamage * 5120) / 4096);
      desc.cataclysmWeather = field.cataclysmWeather;
    } else if (ULTRA_BEASTS.has(defender.name)) {
      baseDamage = pokeRound(OF32(baseDamage * 3072) / 4096);
      desc.cataclysmWeather = field.cataclysmWeather;
    }
  }

  if (isCritical) {
    baseDamage = Math.floor(OF32(baseDamage * 1.5));
    desc.isCritical = isCritical;
    if (field.hasClimateWeather('Blood Moon') && field.isWeatherBoosted &&
        move.hasType('Dark') && move.bp > 0 && move.bp <= 60 && !move.isCrit) {
      desc.climateWeather = field.climateWeather;
    }
  }

  return baseDamage;
}

export function calculateFinalModsSMSSSV(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  desc: RawDesc,
  isCritical = false,
  typeEffectiveness: number,
  hitCount = 0
) {
  const finalMods = [];

  if (field.defenderSide.isReflect && move.category === 'Physical' &&
      !isCritical && !field.defenderSide.isAuroraVeil) {
    // doesn't stack with Aurora Veil
    finalMods.push(field.gameType !== 'Singles' ? 2732 : 2048);
    desc.isReflect = true;
  } else if (
    field.defenderSide.isLightScreen && move.category === 'Special' &&
    !isCritical && !field.defenderSide.isAuroraVeil
  ) {
    // doesn't stack with Aurora Veil
    finalMods.push(field.gameType !== 'Singles' ? 2732 : 2048);
    desc.isLightScreen = true;
  }
  if (field.defenderSide.isAuroraVeil && !isCritical) {
    finalMods.push(field.gameType !== 'Singles' ? 2732 : 2048);
    desc.isAuroraVeil = true;
  }

  if (attacker.hasAbility('Neuroforce') && typeEffectiveness > 1) {
    finalMods.push(5120);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Sniper') && isCritical) {
    finalMods.push(6144);
    desc.attackerAbility = attacker.ability;
  } else if (attacker.hasAbility('Tinted Lens') && typeEffectiveness < 1) {
    finalMods.push(8192);
    desc.attackerAbility = attacker.ability;
  }
  if (
    field.hasIrritantWeather('Pheromones') && field.isWeatherBoosted &&
    attacker.hasType('Bug') && !attacker.hasItem('Safety Goggles') &&
    typeEffectiveness < 1
  ) {
    finalMods.push(8192);
    desc.irritantWeather = field.irritantWeather;
  }

  if (defender.isDynamaxed && move.named('Dynamax Cannon', 'Behemoth Blade', 'Behemoth Bash')) {
    finalMods.push(8192);
  }

  if (defender.hasAbility('Multiscale', 'Shadow Shield') &&
      defender.curHP() === defender.maxHP() &&
      hitCount === 0 &&
      (!field.defenderSide.isSR && (!field.defenderSide.spikes || defender.hasType('Flying')) ||
      defender.hasItem('Heavy-Duty Boots')) && !attacker.hasAbility('Parental Bond (Child)')
  ) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if (defender.hasAbility('Fluffy') && move.flags.contact && !attacker.hasAbility('Long Reach')) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  } else if (
    (defender.hasAbility('Punk Rock') && move.flags.sound) ||
    (defender.hasAbility('Ice Scales') && move.category === 'Special')
  ) {
    finalMods.push(2048);
    desc.defenderAbility = defender.ability;
  }

  if (defender.hasAbility('Solid Rock', 'Filter', 'Prism Armor') && typeEffectiveness > 1) {
    finalMods.push(3072);
    desc.defenderAbility = defender.ability;
  }

  if (field.defenderSide.isFriendGuard) {
    finalMods.push(3072);
    desc.isFriendGuard = true;
  }

  if (defender.hasAbility('Fluffy') && move.hasType('Fire')) {
    finalMods.push(8192);
    desc.defenderAbility = defender.ability;
  }

  if (attacker.hasItem('Expert Belt') && typeEffectiveness > 1 && !move.isZ) {
    finalMods.push(4915);
    desc.attackerItem = attacker.item;
  } else if (attacker.hasItem('Life Orb')) {
    finalMods.push(5324);
    desc.attackerItem = attacker.item;
  } else if (attacker.hasItem('Metronome') && move.timesUsedWithMetronome! >= 1) {
    const timesUsedWithMetronome = Math.floor(move.timesUsedWithMetronome!);
    if (timesUsedWithMetronome <= 4) {
      finalMods.push(4096 + timesUsedWithMetronome * 819);
    } else {
      finalMods.push(8192);
    }
    desc.attackerItem = attacker.item;
  }

  if (move.hasType(getBerryResistType(defender.item)) &&
      (typeEffectiveness > 1 || move.hasType('Normal')) &&
      hitCount === 0 &&
      !attacker.hasAbility('Unnerve', 'As One (Glastrier)', 'As One (Spectrier)')) {
    if (defender.hasAbility('Ripen')) {
      finalMods.push(1024);
    } else {
      finalMods.push(2048);
    }
    desc.defenderItem = defender.item;
  }

  return finalMods;
}

function hasTerrainSeed(pokemon: Pokemon) {
  return pokemon.hasItem('Electric Seed', 'Misty Seed', 'Grassy Seed', 'Psychic Seed');
}
