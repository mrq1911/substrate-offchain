import { ApiPromise, WsProvider } from "@polkadot/api";

const rpcUri = process.env.RPC_URL || "ws://127.0.0.1:8000";

export async function newPjsClient() {
    const provider = new WsProvider(rpcUri);
    const client = await ApiPromise.create({ provider });

    console.log(`Connected to ${rpcUri}`);
    return client;
}

export async function sendAndWaitFinalization({ from, tx, printEvents = [] }) {
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
            }

            if (status.isFinalized) {
                console.log(`Finalized at block: ${status.asFinalized.toHex()}`);
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
