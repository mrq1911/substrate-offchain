import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import fs from 'fs';
import readline from 'readline';

const rpcUri = process.env.RPC_URL || "ws://127.0.0.1:8000";

// Replace with path to your JSON file
const ACCOUNT_JSON_PATH = process.env.ACCOUNT_JSON_PATH || "./account.json";

export async function newPjsClient() {
    const provider = new WsProvider(rpcUri);
    const client = await ApiPromise.create({ provider });
    console.log(`Connected to ${rpcUri}`);
    return client;
}

export async function sendTx({ from, tx, printEvents = [] }) {
    return new Promise((resolve, reject) => {
        tx.signAndSend(from, (receipt) => {
            const { status, events = [], dispatchError } = receipt;
            if (status.isInBlock) {
                console.log(`Included in block: ${status.asInBlock.toHex()}`);
                events
                  .filter(({ event: { section } }) => printEvents.includes(section))
                  .forEach(({ event: { data, method, section } }) => {
                      console.log(`${section}.${method} ${JSON.stringify(data)}`);
                  });
                resolve(receipt);
            }
            if (dispatchError) {
                if (dispatchError.isModule) {
                    const decoded = tx.registry.findMetaError(dispatchError.asModule);
                    reject(new Error(`Transaction failed: ${decoded.section}.${decoded.name} ${decoded.docs}`));
                } else {
                    reject(new Error(dispatchError.toString()));
                }
            }
        }).catch(reject);
    });
}

// Function to prompt for password
function promptPassword() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Use the question method to prompt for password
        rl.question('Enter password for the account (input will be hidden): ', (password) => {
            // Close the interface
            rl.close();
            resolve(password);
        });

        // This attempts to hide the password as it's typed, but note that
        // this is not a perfect solution in all environments
        process.stdin.on('data', (char) => {
            char = char + '';
            switch (char) {
                case '\n': case '\r': case '\u0004':
                    // Do nothing on line terminators
                    break;
                default:
                    // Write a backspace character to stdout using unicode escape sequence
                    process.stdout.write('\u001B[2K\u001B[200D' + 'Enter password for the account (input will be hidden): ' + '*'.repeat(process.stdout.hiddenCharsCount = (process.stdout.hiddenCharsCount || 0) + 1));
                    break;
            }
        });
    });
}

export async function createSignerFromJson(jsonPath = ACCOUNT_JSON_PATH) {
    await cryptoWaitReady();

    // Set raw mode for password input if supported
    const originalStdinIsRaw = process.stdin.isRaw;
    if (typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(true);
    }

    try {
        // Read the JSON keystore file
        const keystore = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

        // Create keyring and signer
        const keyring = new Keyring({ type: "sr25519" });
        const signer = keyring.addFromJson(keystore);

        // Prompt for password and decrypt the account
        const password = await promptPassword();
        try {
            signer.decodePkcs8(password);
            console.log("Account unlocked successfully");
            console.log(`Using account: ${signer.address}`);
            return signer;
        } catch (error) {
            console.log("Failed to unlock account. Incorrect password?");
            throw error;
        }
    } finally {
        // Restore original stdin mode if we changed it
        if (typeof process.stdin.setRawMode === 'function') {
            process.stdin.setRawMode(originalStdinIsRaw);
        }
    }
}
