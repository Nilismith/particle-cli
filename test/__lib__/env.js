const os = require('os');
const path = require('path');
const PATH_REPO_DIR = path.join(__dirname, '..', '..');
const PATH_TEST_DIR = path.join(PATH_REPO_DIR, 'test');
const PATH_TMP_DIR = path.join(PATH_TEST_DIR, 'tmp');
const PATH_FIXTURES_DIR = path.join(PATH_TEST_DIR, '__fixtures__');
const PATH_PARTICLE_DIR = path.join(os.homedir(), '.particle');
const PATH_PARTICLE_PUBLIC_DIR = path.join(os.homedir(), 'Particle');
const PATH_PARTICLE_PROJECTS_DIR = path.join(PATH_PARTICLE_PUBLIC_DIR, 'projects');
const PATH_PARTICLE_LIBRARIES_DIR = path.join(PATH_PARTICLE_PUBLIC_DIR, 'community', 'libraries');
const PATH_PARTICLE_PROFILE = path.join(PATH_PARTICLE_DIR, 'particle.config.json');
const PATH_PROJ_BLANK_INO = path.join(PATH_FIXTURES_DIR, 'blank', 'src', 'blank.ino');
const PATH_PROJ_STROBY_INO = path.join(PATH_FIXTURES_DIR, 'stroby', 'src', 'stroby.ino');

require('dotenv').config({ path: path.join(PATH_TEST_DIR, '.env') });

const {
	E2E_USERNAME: USERNAME,
	E2E_PASSWORD: PASSWORD,
	E2E_DEVICE_ID: DEVICE_ID,
	E2E_DEVICE_NAME: DEVICE_NAME,
	E2E_DEVICE_PLATFORM_ID: DEVICE_PLATFORM_ID,
	E2E_DEVICE_PLATFORM_NAME: DEVICE_PLATFORM_NAME
} = process.env;


module.exports = {
	USERNAME,
	PASSWORD,
	DEVICE_ID,
	DEVICE_NAME,
	DEVICE_PLATFORM_ID,
	DEVICE_PLATFORM_NAME,
	PATH_REPO_DIR,
	PATH_TEST_DIR,
	PATH_FIXTURES_DIR,
	PATH_TMP_DIR,
	PATH_PARTICLE_DIR,
	PATH_PARTICLE_PROJECTS_DIR,
	PATH_PARTICLE_LIBRARIES_DIR,
	PATH_PARTICLE_PROFILE,
	PATH_PROJ_BLANK_INO,
	PATH_PROJ_STROBY_INO
};

