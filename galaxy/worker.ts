// Mirrors src/render/galaxy.worker.ts in the game.
import { runGalaxyWorker, type GalaxyWorkerScope } from './galaxy';
runGalaxyWorker(self as unknown as GalaxyWorkerScope);
