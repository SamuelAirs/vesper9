import {
  OrbitLock,
  Moonrunner,
  Undertow,
  EchoVault,
  LightTrial,
  GlyphVault,
} from "./games.js";
import { MorseSchool } from "./morse.js";
import {
  Timers,
  Transcription,
  Environment,
  Diagnostics,
  Settings,
} from "./utilities.js";
import { CARTRIDGES } from "./catalog.js";
const FACTORIES = { OrbitLock, Moonrunner, Undertow, EchoVault, LightTrial, GlyphVault,
  MorseSchool, Timers, Transcription, Environment, Diagnostics, Settings };
export const APPS = CARTRIDGES.map(meta => {
  const Factory = FACTORIES[meta.factory];
  if (!Factory) throw new Error('Missing cartridge factory: ' + meta.factory);
  return { ...meta, create: ctx => new Factory(ctx) };
});
