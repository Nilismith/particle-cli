const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const nock = require('nock');
const { expect, sinon } = require('../../test/setup');
const LogicFunctionCommands = require('./logic-function');
const { PATH_FIXTURES_LOGIC_FUNCTIONS, PATH_TMP_DIR } = require('../../test/lib/env');




describe('LogicFunctionCommands', () => {
	let logicFunctionCommands;
	let originalUi = new LogicFunctionCommands().ui;
	let logicFunc1 = fs.readFileSync(path.join(PATH_FIXTURES_LOGIC_FUNCTIONS, 'logicFunc1.json'), 'utf-8');
	logicFunc1 = JSON.parse(logicFunc1);
	let logicFunc2 = fs.readFileSync(path.join(PATH_FIXTURES_LOGIC_FUNCTIONS, 'logicFunc2.json'), 'utf-8');
	logicFunc2 = JSON.parse(logicFunc2);

	beforeEach(async () => {
		logicFunctionCommands = new LogicFunctionCommands();
		logicFunctionCommands.ui = {
			stdout: {
				write: sinon.stub()
			},
			stderr: {
				write: sinon.stub()
			},
			chalk: {
				bold: sinon.stub(),
				cyanBright: sinon.stub(),
				yellow: sinon.stub(),
				grey: sinon.stub(),
			},
		};
	});

	afterEach(async () => {
		// TODO: Fill this out?
		logicFunctionCommands.ui = originalUi;
		// remove tmp dir
		fs.emptyDirSync(PATH_TMP_DIR);

	});

	describe('list', () => {
		it('lists logic functions in Sandbox', async () => {
			const stub = nock('https://api.particle.io/v1', )
				.intercept('/logic/functions', 'GET')
				.reply(200, logicFunc1);
			const expectedResp = logicFunc1.logic_functions;

			const res = await logicFunctionCommands.list({});
			expect(res).to.eql(expectedResp);
			expect (stub.isDone()).to.be.true;
		});

		it('lists logic functions in Org', async () => {
			const stub = nock('https://api.particle.io/v1/orgs/particle')
				.intercept('/logic/functions', 'GET')
				.reply(200, logicFunc2);
			const expectedResp = logicFunc2.logic_functions;

			const res = await logicFunctionCommands.list({ org: 'particle' });
			expect(res).to.eql(expectedResp);
			expect (stub.isDone()).to.be.true;
		});

		it('shows relevant msg is no logic functions are found', async () => {
			const stub = nock('https://api.particle.io/v1', )
				.intercept('/logic/functions', 'GET')
				.reply(200, { logic_functions: [] });
			const expectedResp = [];

			const res = await logicFunctionCommands.list({});
			expect(res).to.eql(expectedResp);
			expect(logicFunctionCommands.ui.stdout.write.callCount).to.equal(2);
			expect(logicFunctionCommands.ui.stdout.write.firstCall.args[0]).to.equal('No Logic Functions currently deployed in your Sandbox.');
			expect (stub.isDone()).to.be.true;
		});

		it('throws an error if API is not accessible', async () => {
			const stub = nock('https://api.particle.io/v1', )
				.intercept('/logic/functions', 'GET')
				.reply(500, { error: 'Internal Server Error' });

			let error;
			try {
				await logicFunctionCommands.list({});
			} catch (e) {
				error = e;
			}

			expect(error).to.be.an.instanceOf(Error);
			expect(error.message).to.equal('Error listing logic functions: Internal Server Error');
			expect (stub.isDone()).to.be.true;
		});

		it('throws an error if org is not found', async () => {
			nock('https://api.particle.io/v1/orgs/particle')
				.intercept('/logic/functions', 'GET')
				.reply(404, { error: 'Organization Not Found' });

			let error;
			try {
				await logicFunctionCommands.list({ org: 'particle' });
			} catch (e) {
				error = e;
			}

			expect(error).to.be.an.instanceOf(Error);
			expect(error.message).to.equal('Error listing logic functions: Organization Not Found');
		});
	});

	describe('create', () => {
		it('creates a logic function locally for Sandbox account', async () => {
			nock('https://api.particle.io/v1', )
				.intercept('/logic/functions', 'GET')
				.reply(200, { logic_functions: [] });
			logicFunctionCommands.ui.prompt = sinon.stub();
			logicFunctionCommands.ui.prompt.onCall(0).resolves({ name: 'logic func 1' });
			logicFunctionCommands.ui.prompt.onCall(1).resolves({ description: 'Logic Function 1' });
			const filePaths = await logicFunctionCommands.create({
				params: { filepath: PATH_TMP_DIR }
			});
			const expectedFiles = ['logic-func-1/code.js', 'logic-func-1/configuration.json'];
			// Iterate through each file path and check inclusion
			for (const expectedFile of expectedFiles) {
				const includesExpected = filePaths.some(value => value.includes(expectedFile));
				expect(includesExpected, `File path "${expectedFile}" does not include expected values`).to.be.true;
			}
		});

		it('shows warning if we cannot look up to cloud for existing logic functions', async () => {
			nock('https://api.particle.io/v1', )
				.intercept('/logic/functions', 'GET')
				.reply(403);
			logicFunctionCommands.ui.prompt = sinon.stub();
			logicFunctionCommands.ui.prompt.onCall(0).resolves({ name: 'logicFunc1' });
			logicFunctionCommands.ui.prompt.onCall(1).resolves({ description: 'Logic Function 1' });
			await logicFunctionCommands.create({
				params: { filepath: PATH_TMP_DIR }
			});
			expect(logicFunctionCommands.ui.chalk.yellow.callCount).to.equal(1);
			expect(logicFunctionCommands.ui.chalk.yellow.firstCall.args[0]).to.equal(`Warn: We were unable to check if a Logic Function with name logicFunc1 already exists.${os.EOL}`);
		});

		it('ask to overwrite if files already exist', async () => {
			nock('https://api.particle.io/v1', )
				.intercept('/logic/functions', 'GET')
				.reply(200, { logic_functions: [] });
			fs.createFileSync(path.join(PATH_TMP_DIR, 'logicFunc1', 'code.js'));
			fs.createFileSync(path.join(PATH_TMP_DIR, 'logicFunc1', 'configuration.json'));
			logicFunctionCommands.ui.prompt = sinon.stub();
			logicFunctionCommands.ui.prompt.onCall(0).resolves({ name: 'logicFunc1' });
			logicFunctionCommands.ui.prompt.onCall(1).resolves({ description: 'Logic Function 1' });
			logicFunctionCommands.ui.prompt.onCall(2).resolves({ overwrite: true });
			await logicFunctionCommands.create({
				params: { filepath: PATH_TMP_DIR }
			});
			expect(logicFunctionCommands.ui.prompt.callCount).to.equal(3);
			expect(logicFunctionCommands.ui.prompt.thirdCall.lastArg[0].message).to.contain('We found existing files in');
		});

		it('throws an error if logic function already exists', async () => {
			nock('https://api.particle.io/v1', )
				.intercept('/logic/functions', 'GET')
				.reply(200, logicFunc1);
			logicFunctionCommands.ui.prompt = sinon.stub();
			logicFunctionCommands.ui.prompt.onCall(0).resolves({ name: 'LF1' });
			logicFunctionCommands.ui.prompt.onCall(1).resolves({ description: 'Logic Function 1' });
			let error;
			try {
				const files = await logicFunctionCommands.create({
					params: { filepath: PATH_TMP_DIR }
				});
				console.log(files);
			} catch (e) {
				error = e;
			}
			expect(error).to.be.an.instanceOf(Error);
			expect(error.message).to.equal('Error: Logic Function with name LF1 already exists.');
		});

	});
});
