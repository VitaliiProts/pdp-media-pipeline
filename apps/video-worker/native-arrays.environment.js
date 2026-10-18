const { TestEnvironment } = require('jest-environment-node');

/**
 * onnxruntime-node builds its outputs from typed arrays of the main realm and checks inputs
 * against the same constructors, so tests that run a model share them with the test realm.
 * Tests get a copy of `process.env`, so the telemetry switch Supertonic sets is set here for
 * the native library too.
 */
class NativeArraysEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    process.env.ORT_DISABLE_TELEMETRY = '1';
    for (const name of [
      'ArrayBuffer',
      'Float32Array',
      'Float64Array',
      'Int8Array',
      'Int16Array',
      'Int32Array',
      'Uint8Array',
      'Uint16Array',
      'Uint32Array',
      'BigInt64Array',
      'BigUint64Array',
    ]) {
      this.global[name] = globalThis[name];
    }
  }
}

module.exports = NativeArraysEnvironment;
