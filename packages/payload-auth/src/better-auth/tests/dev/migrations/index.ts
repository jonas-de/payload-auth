import * as migration_20260305_071436_init from './20260305_071436_init';
import * as migration_20260305_072846_removeEmialHarmony from './20260305_072846_removeEmialHarmony';
import * as migration_20260322_212925_init from './20260322_212925_init';
import * as migration_20260729_172137 from './20260729_172137';

export const migrations = [
  {
    up: migration_20260305_071436_init.up,
    down: migration_20260305_071436_init.down,
    name: '20260305_071436_init',
  },
  {
    up: migration_20260305_072846_removeEmialHarmony.up,
    down: migration_20260305_072846_removeEmialHarmony.down,
    name: '20260305_072846_removeEmialHarmony',
  },
  {
    up: migration_20260322_212925_init.up,
    down: migration_20260322_212925_init.down,
    name: '20260322_212925_init',
  },
  {
    up: migration_20260729_172137.up,
    down: migration_20260729_172137.down,
    name: '20260729_172137'
  },
];
