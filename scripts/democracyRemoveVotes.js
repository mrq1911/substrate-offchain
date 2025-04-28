#!/usr/bin/env node
import {newPjsClient, sendTx, createSignerFromJson} from "./clients/pjs.js";
import {BN} from "bn.js";

function log(text) {
    console.log(text);
}

const chunkify = (a, size) => Array(Math.ceil(a.length / size)).fill(a).map((_, i) => a.slice(i * size, i * size + size));

async function main() {
    try {
        log("Started democracyVotingRemoveVotes...");

        // First, create a client
        let client = await newPjsClient();

        // Then create signer from JSON keystore file
        const signer = await createSignerFromJson();

        let txs = [];

        const votingEntries = await client.query.democracy.votingOf.entries();
        log(`votingOf entries found: ${votingEntries.length}`);

        votingEntries.forEach(([key, voting]) => {
            // const [address, classOf] = key.args.map(k => k.toHuman());
            const [address] = key.toHuman();
            if (voting.isDirect) {
                voting.asDirect.votes.map(v => {
                    txs.push(client.tx.democracy.forceRemoveVote(address, v[0].toString()));
                });
            } else {
                voting.asDelegating.votes?.map(v => {
                    txs.push(client.tx.democracy.forceRemoveVote(address, v[0].toString()));
                });
            }
        });

        log(`Tx count: ${txs.length}`);

        let weightLimit = client.consts.system.blockWeights.perClass.normal.maxExtrinsic;

        const allTxs = client.tx.utility.batch(txs);
        let allTxsInfo = await allTxs.paymentInfo(signer);
        let allTxsWeight = allTxsInfo.weight;

        log(`Weight limits per block: ${JSON.stringify(weightLimit.toHuman(), null, 2)}`);
        log(`Txs weight limit: ${JSON.stringify(allTxsWeight.toHuman(), null, 2)}`);

        let refTimeLimit = new BN(weightLimit.unwrap().refTime.toString());
        let allTxsRefTime = new BN(allTxsWeight.refTime.toString());
        let batchesCountRefTime = allTxsRefTime.div(refTimeLimit).toNumber() + 1;
        log(`Max RefTime requires splitting in ${batchesCountRefTime} batches`);

        let proofSizeLimit = new BN(weightLimit.unwrap().proofSize.toString());
        let allTxsProofSize = new BN(allTxsWeight.proofSize.toString());
        let batchesCountProofSize = allTxsProofSize.div(proofSizeLimit).toNumber() + 1;
        log(`Max ProofSize requires splitting in ${batchesCountProofSize} batches`);

        // Multiply by 2 to leave some space in the block for regular txs
        const batchesCount = Math.max(batchesCountRefTime, batchesCountProofSize) * 2;
        log(`Splitting the txs into ${batchesCount} batches...`)

        let perBatch = Math.ceil(txs.length / batchesCount);
        log(`perBatch ${perBatch}`)
        const batches = chunkify(txs, perBatch).map(tx => client.tx.utility.batch(tx));

        for (const [index, batch] of batches.entries()) {
            log(`Processing batch ${index + 1}`);
            await sendTx({ from: signer, tx: batch});
        }

        log("Finished democracyVotingRemoveVotes.");
    } catch (error) {
        console.error("Error:", error);
        process.exit(1); // Exit with error code
    }
}

main().then(r => process.exit(0));
