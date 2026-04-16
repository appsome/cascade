/**
 * PM provider barrel — side-effect imports register each provider manifest
 * into `pmProviderRegistry` at module load.
 *
 * Order is registration order (deterministic for the wizard dropdown). Plans
 * 006/3 and 006/4 will append `./jira/index.js` and `./linear/index.js`.
 */

import './trello/index.js';
import './jira/index.js';
