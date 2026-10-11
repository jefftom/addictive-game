import { runGalaxyWorker, type GalaxyWorkerScope } from './galaxy';

/** Module worker body: generates galaxy sectors off the main thread (see galaxy.ts). */
runGalaxyWorker(self as unknown as GalaxyWorkerScope);
