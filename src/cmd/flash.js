const fs = require('fs-extra');
const os = require('os');
const ParticleApi = require('./api');
const { ModuleInfo } = require('binary-version-reader');
const { errors: { usageError } } = require('../app/command-processor');
const usbUtils = require('./usb-util');
const CLICommandBase = require('./base');
const { platformForId } = require('../lib/platform');
const settings = require('../../settings');
const path = require('path');
const utilities = require('../lib/utilities');
const CloudCommand = require('./cloud');
const BundleCommand = require('./bundle');
const temp = require('temp').track();
const { knownAppNames, knownAppsForPlatform } = require('../lib/known-apps');
const { sourcePatterns, binaryPatterns, binaryExtensions } = require('../lib/file-types');
const deviceOsUtils = require('../lib/device-os-version-util');
const semver = require('semver');
const { createFlashSteps, filterModulesToFlash, parseModulesToFlash, flashFiles, validateDFUSupport } = require('../lib/flash-helper');
const createApiCache = require('../lib/api-cache');

module.exports = class FlashCommand extends CLICommandBase {
	constructor(...args) {
		super(...args);
	}

	async flash(device, binary, files, {
		local,
		usb,
		serial,
		factory,
		target,
		port,
		yes,
		'application-only': applicationOnly
	}) {
		if (!device && !binary && !local) {
			// if no device nor files are passed, show help
			throw usageError('You must specify a device or a file');
		}

		this.ui.logFirstTimeFlashWarning();

		if (usb) {
			await this.flashOverUsb({ binary, factory });
		} else if (serial) {
			await this.flashYModem({ binary, port, yes });
		} else if (local) {
			let allFiles = binary ? [binary, ...files] : files;
			await this.flashLocal({ files: allFiles, applicationOnly, target });
		} else {
			await this.flashCloud({ device, files, target });
		}

		this.ui.write('Flash success!');
	}

	async flashOverUsb({ binary, factory }) {
		let device;
		try {
			if (utilities.getFilenameExt(binary) === '.zip') {
				throw new Error("Use 'particle flash --local' to flash a zipped bundle.");
			}
			
			const { api, auth } = this._particleApi();
			device = await usbUtils.getOneUsbDevice({ api, auth, ui: this.ui });
			const platformName = platformForId(device.platformId).name;
			validateDFUSupport({ device, ui: this.ui });

			let files;
			const knownAppPath = knownAppsForPlatform(platformName)[binary];
			if (knownAppPath) {
				files = [knownAppPath];
			} else {
				files = [binary];
			}

			const modulesToFlash = await parseModulesToFlash({ files });

			await this._validateModulesForPlatform({
				modules: modulesToFlash,
				platformId: device.platformId,
				platformName
			});
			const flashSteps = await createFlashSteps({
				modules: modulesToFlash,
				isInDfuMode: device.isInDfuMode,
				platformId: device.platformId,
				factory
			});

			this.ui.write(`Flashing ${platformName} device ${device.id}`);
			const resetAfterFlash = !factory && modulesToFlash[0].prefixInfo.moduleFunction === ModuleInfo.FunctionType.USER_PART;
			await flashFiles({ device, flashSteps, resetAfterFlash, ui: this.ui });
		} catch (error) {
			if (device) {
				await device.close();
			}
		}
	}

	flashCloud({ device, files, target }) {
		const CloudCommands = require('../cmd/cloud');
		const args = { target, params: { device, files } };
		return new CloudCommands().flashDevice(args);
	}

	flashYModem({ binary, port, yes }) {
		const SerialCommands = require('../cmd/serial');
		return new SerialCommands().flashDevice(binary, { port, yes });
	}

	async flashLocal({ files, applicationOnly, target }) {
		const { files: parsedFiles, deviceIdOrName, knownApp } = await this._analyzeFiles(files);
		const { api, auth } = this._particleApi();
		const device = await usbUtils.getOneUsbDevice({ idOrName: deviceIdOrName, api, auth, ui: this.ui });

		const platformName = platformForId(device.platformId).name;

		this.ui.write(`Flashing ${platformName} ${deviceIdOrName || device.id}`);
		validateDFUSupport({ device, ui: this.ui });

		let { skipDeviceOSFlash, files: filesToFlash } = await this._prepareFilesToFlash({
			knownApp,
			parsedFiles,
			platformId: device.platformId,
			platformName,
			target
		});

		filesToFlash = await this._processBundle({ filesToFlash });

		const fileModules = await parseModulesToFlash({ files: filesToFlash });
		await this._validateModulesForPlatform({ modules: fileModules, platformId: device.platformId, platformName });

		const deviceOsBinaries = await this._getDeviceOsBinaries({
			currentDeviceOsVersion: device.firmwareVersion,
			skipDeviceOSFlash,
			target,
			modules: fileModules,
			platformId: device.platformId,
			applicationOnly
		});
		const deviceOsModules = await parseModulesToFlash({ files: deviceOsBinaries });
		let modulesToFlash = [...fileModules, ...deviceOsModules];
		modulesToFlash = filterModulesToFlash({ modules: modulesToFlash, platformId: device.platformId });

		const flashSteps = await createFlashSteps({ modules: modulesToFlash, isInDfuMode: device.isInDfuMode , platformId: device.platformId });
		await flashFiles({ device, flashSteps, ui: this.ui });
	}


	async _analyzeFiles(files) {
		const apps = knownAppNames();

		// assume the user wants to compile/flash the current directory if no argument is passed
		if (files.length === 0) {
			return {
				files: ['.'],
				deviceIdOrName: null,
				knownApp: null
			};
		}

		// check if the first argument is a known app
		const [knownApp] = files;
		if (apps.includes(knownApp)) {
			return {
				files: [],
				deviceIdOrName: null,
				knownApp
			};
		}

		// check if the second argument is a known app
		if (files.length > 1) {
			const [deviceIdOrName, knownApp] = files;
			if (apps.includes(knownApp)) {
				return {
					files: [],
					deviceIdOrName,
					knownApp
				};
			}
		}

		// check if the first argument exists in the filesystem, regardless if it's a file or directory
		try {
			await fs.stat(files[0]);
			return {
				files,
				deviceIdOrName: null,
				knownApp: null
			};
		} catch (error) {
			// file doesn't exist, assume the first argument is a device
			const [deviceIdOrName, ...remainingFiles] = files;
			return {
				files: remainingFiles,
				deviceIdOrName,
				knownApp: null
			};
		}
	}

	// Should be part fo CLICommandBase??
	_particleApi() {
		const auth = settings.access_token;
		const api = new ParticleApi(settings.apiUrl, { accessToken: auth } );
		const apiCache = createApiCache(api);
		return { api: apiCache, auth };
	}

	async _prepareFilesToFlash({ knownApp, parsedFiles, platformId, platformName, target }) {
		if (knownApp) {
			const knownAppPath = knownAppsForPlatform(platformName)[knownApp];
			if (knownAppPath) {
				return { skipDeviceOSFlash: true, files: [knownAppPath] };
			} else {
				throw new Error(`Known app ${knownApp} is not available for ${platformName}`);
			}
		}

		const [filePath] = parsedFiles;
		let stats;
		try {
			stats = await fs.stat(filePath);
		} catch (error) {
			// ignore error
		}

		// if a directory, figure out if it's a source directory that should be compiled
		// or a binary directory that should be flashed directly
		if (stats && stats.isDirectory()) {
			const binaries = utilities.globList(filePath, binaryPatterns);
			const sources = utilities.globList(filePath, sourcePatterns);

			if (binaries.length > 0 && sources.length === 0) {
				// this is a binary directory so get all the binaries from all the parsedFiles
				const binaries = await this._findBinaries(parsedFiles);
				return { skipDeviceOSFlash: false, files: binaries };
			} else if (sources.length > 0) {
				// this is a source directory so compile it
				const compileResult = await this._compileCode({ parsedFiles, platformId, target });
				return { skipDeviceOSFlash: false, files: compileResult };
			} else {
				throw new Error('No files found to flash');
			}
		} else {
			// this is a file so figure out if it's a source file that should be compiled or a
			// binary that should be flashed directly
			if (binaryExtensions.includes(path.extname(filePath))) {
				const binaries = await this._findBinaries(parsedFiles);
				return { skipDeviceOSFlash: false, files: binaries };
			} else {
				const compileResult = await this._compileCode({ parsedFiles, platformId, target });
				return { skipDeviceOSFlash: false, files: compileResult };
			}
		}
	}

	async _compileCode({ parsedFiles, platformId, target }) {
		const cloudCommand = new CloudCommand();
		const saveTo = temp.path({ suffix: '.zip' }); // compileCodeImpl will pick between .bin and .zip as appropriate
		const { filename } = await cloudCommand.compileCodeImpl({ target, saveTo, platformId, files: parsedFiles });
		return [filename];
	}

	async _findBinaries(parsedFiles) {
		const binaries = new Set();
		for (const filePath of parsedFiles) {
			try {
				const stats = await fs.stat(filePath);
				if (stats.isDirectory()) {
					const found = utilities.globList(filePath, binaryPatterns);
					for (const binary of found) {
						binaries.add(binary);
					}
				} else {
					binaries.add(filePath);
				}
			} catch (error) {
				throw new Error(`I couldn't find that: ${filePath}`);
			}

		}
		return Array.from(binaries);
	}

	async _processBundle({ filesToFlash }) {
		const bundle = new BundleCommand();
		const processed = await Promise.all(filesToFlash.map(async (filename) => {
			if (path.extname(filename) === '.zip') {
				return bundle.extractModulesFromBundle({ bundleFilename: filename });
			} else {
				return filename;
			}
		}));

		return processed.flat();
	}

	async _validateModulesForPlatform({ modules, platformId, platformName }) {
		for (const moduleInfo of modules) {
			if (!moduleInfo.crc.ok) {
				throw new Error(`CRC check failed for module ${moduleInfo.filename}`);
			}
			if (moduleInfo.prefixInfo.platformID !== platformId && moduleInfo.prefixInfo.moduleFunction !== ModuleInfo.FunctionType.ASSET) {
				throw new Error(`Module ${moduleInfo.filename} is not compatible with platform ${platformName}`);
			}
		}
	}

	async _getDeviceOsBinaries({ skipDeviceOSFlash, target, modules, currentDeviceOsVersion, platformId, applicationOnly }) {
		const { api } = this._particleApi();
		const { module: application, applicationDeviceOsVersion } = await this._pickApplicationBinary(modules, api);

		// if files to flash include Device OS binaries, don't override them with the ones from the cloud
		const includedDeviceOsModuleFunctions = [ModuleInfo.FunctionType.SYSTEM_PART, ModuleInfo.FunctionType.BOOTLOADER];
		const systemPartBinaries = modules.filter(m => includedDeviceOsModuleFunctions.includes(m.prefixInfo.moduleFunction));
		if (systemPartBinaries.length) {
			return [];
		}

		// no application so no need to download Device OS binaries
		if (!application) {
			return [];
		}

		// need to get the binary required version
		if (applicationOnly) {
			return [];
		}

		// force to flash device os binaries if target is specified
		if (target) {
			return deviceOsUtils.downloadDeviceOsVersionBinaries({
				api,
				platformId,
				version: target,
				ui: this.ui,
				omitUserPart: true
			});
		}

		// avoid downgrading Device OS for known application like Tinker compiled against older Device OS
		if (skipDeviceOSFlash) {
			return [];
		}

		// if Device OS needs to be upgraded, so download the binaries
		if (applicationDeviceOsVersion && currentDeviceOsVersion && semver.lt(currentDeviceOsVersion, applicationDeviceOsVersion)) {
			return deviceOsUtils.downloadDeviceOsVersionBinaries({
				api: api,
				platformId,
				version: applicationDeviceOsVersion,
				ui: this.ui,
			});
		} else {
			// Device OS is up to date or we don't know the current Device OS version, so no need to download binaries
			return [];
		}
	}

	async _pickApplicationBinary(modules, api) {
		for (const module of modules) {
			// parse file and look for moduleFunction
			if (module.prefixInfo.moduleFunction === ModuleInfo.FunctionType.USER_PART) {
				const internalVersion = module.prefixInfo.depModuleVersion;
				let applicationDeviceOsVersionData = { version: null };
				try {
					applicationDeviceOsVersionData = await api.getDeviceOsVersions(module.prefixInfo.platformID, internalVersion);
				} catch (error) {
					// ignore if Device OS version from the application cannot be identified
				}
				return { module, applicationDeviceOsVersion: applicationDeviceOsVersionData.version };
			}
		}
		return { module: null, applicationDeviceOsVersion: null };
	}

	_createFlashProgress({ flashSteps }) {
		const NORMAL_MULTIPLIER = 10; // flashing in normal mode is slower so count each byte more
		const { isInteractive } = this.ui;
		let progressBar;
		if (isInteractive) {
			progressBar = this.ui.createProgressBar();
			// double the size to account for the erase and programming steps
			const total = flashSteps.reduce((total, step) => total + step.data.length * 2 * (step.flashMode === 'normal' ? NORMAL_MULTIPLIER : 1), 0);
			progressBar.start(total, 0, { description: 'Preparing to flash' });
		}

		let flashMultiplier = 1;
		let eraseSize = 0;
		let step = null;
		let description;
		return (payload) => {
			switch (payload.event) {
				case 'flash-file':
					description = `Flashing ${payload.filename}`;
					if (isInteractive) {
						progressBar.update({ description });
					} else {
						this.ui.stdout.write(`${description}${os.EOL}`);
					}
					step = flashSteps.find(step => step.name === payload.filename);
					flashMultiplier = step.flashMode === 'normal' ? NORMAL_MULTIPLIER : 1;
					eraseSize = 0;
					break;
				case 'switch-mode':
					description = `Switching device to ${payload.mode} mode`;
					if (isInteractive) {
						progressBar.update({ description });
					} else {
						this.ui.stdout.write(`${description}${os.EOL}`);
					}
					break;
				case 'erased':
					if (isInteractive) {
						// In DFU, entire sectors are erased so the count of bytes can be higher than the actual size
						// of the file. Ignore the extra bytes to avoid issues with the progress bar
						if (step && eraseSize + payload.bytes > step.data.length) {
							progressBar.increment((step.data.length - eraseSize) * flashMultiplier);
							eraseSize = step.data.length;
						} else {
							progressBar.increment(payload.bytes * flashMultiplier);
							eraseSize += payload.bytes;
						}
					}
					break;
				case 'downloaded':
					if (isInteractive) {
						progressBar.increment(payload.bytes * flashMultiplier);
					}
					break;
				case 'finish':
					if (isInteractive) {
						progressBar.stop();
					}
					break;
			}
		};
	}
};
