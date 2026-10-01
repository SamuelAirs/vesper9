import { OrbitLock } from "./orbit.js";
import { Moonrunner } from "./runner.js";
import { Undertow } from "./undertow.js";
import { EchoVault } from "./echo.js";
import { LightTrial } from "./reaction.js";
import { GlyphVault } from "./glyphs.js";
import { MorseSchool } from "./morse.js";
import {
  Timers,
  Transcription,
  Environment,
  Diagnostics,
  Settings,
} from "./utilities.js";
import { Pulsar } from "./pulsar.js";
import { Perihelion } from "./perihelion.js";
import { Descent } from "./descent.js";
import { Ricochet } from "./ricochet.js";
import { Helix } from "./helix.js";
import { Ballista } from "./ballista.js";
import { Tideline } from "./tideline.js";
import { Outpost } from "./outpost.js";
import { Lantern } from "./lantern.js";
import { Cadence } from "./cadence.js";
import { Ephemeris } from "./ephemeris.js";
import { Resonance } from "./resonance.js";
import { Oracle } from "./oracle.js";
import { Telemetry } from "./telemetry.js";
import { Meridian } from "./meridian.js";
import { CARTRIDGES } from "./catalog.js";
const FACTORIES = { OrbitLock, Moonrunner, Undertow, EchoVault, LightTrial, GlyphVault,
  MorseSchool, Timers, Transcription, Environment, Diagnostics, Settings,
  Pulsar, Perihelion, Descent, Ricochet, Helix, Ballista,
  Tideline, Outpost,
  Lantern, Cadence, Ephemeris, Resonance, Oracle, Telemetry,
  Meridian };
export const APPS = CARTRIDGES.map(meta => {
  const Factory = FACTORIES[meta.factory];
  if (!Factory) throw new Error('Missing cartridge factory: ' + meta.factory);
  return { ...meta, create: ctx => new Factory(ctx) };
});
