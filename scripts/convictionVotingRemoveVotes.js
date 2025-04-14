#!/usr/bin/env node
import {newPjsClient, sendAndWaitFinalization} from "./clients/pjs.js";
import {Keyring} from "@polkadot/api";
import {cryptoWaitReady} from "@polkadot/util-crypto";
import {BN} from "bn.js";

const ACCOUNT_SECRET = process.env.ACCOUNT_SECRET || "//Alice";

function log(text) {
    console.log(text);
}

const chunkify = (a, size) => Array(Math.ceil(a.length / size)).fill(a).map((_, i) => a.slice(i * size, i * size + size));

async function main() {
    try {
        log("Started convictionVotingRemoveVotes...");
        await cryptoWaitReady();
        let client = await newPjsClient();
        const keyring = new Keyring({type: "sr25519"});
        const signer = keyring.addFromUri(ACCOUNT_SECRET);

        let txs = [];

        const votingEntries = await client.query.convictionVoting.votingFor.entries();
        log(`votingFor entries found: ${votingEntries.length}`);

        // Get all referenda statuses
        let referendumEntries = await client.query.referenda.referendumInfoFor.entries();
        let finishedReferenda = new Set();

        referendumEntries.forEach(([storageKey, info]) => {
            const referendumIndex = storageKey.args[0].toNumber(); // assuming it's Compact<u32>

            // Only include referenda that are finished (Confirmed, TimedOut, Rejected, Approved)
            if (info.unwrap().type !== "Ongoing") {
                finishedReferenda.add(referendumIndex);
            }
        });

        votingEntries.forEach(([key, voting]) => {
            const [address, classOf] = key.args.map(k => k.toHuman());

            if (voting.isCasting) {
                voting.asCasting.votes.forEach(([refIndex, _]) => {
                    if (finishedReferenda.has(refIndex.toNumber())) {
                        txs.push(client.tx.convictionVoting.forceRemoveVote(address, classOf, refIndex.toString()));
                    }
                });
            } else {
                voting.asDelegating.votes?.forEach(([refIndex, _]) => {
                    if (finishedReferenda.has(refIndex.toNumber())) {
                        txs.push(client.tx.convictionVoting.forceRemoveVote(address, classOf, refIndex.toString()));
                    }
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

        const batchesCount = Math.max(batchesCountRefTime, batchesCountProofSize) + 3;
        log(`Splitting the txs into ${batchesCount} batches...`)

        let perBatch = Math.ceil(txs.length / batchesCount);
        log(`perBatch ${perBatch}`)
        const batches = chunkify(txs, perBatch).map(tx => client.tx.utility.batch(tx));

        for (const [index, batch] of batches.entries()) {
            log(`Processing batch ${index + 1}`);
            await sendAndWaitFinalization({ from: signer, tx: batch});
        }

        log("Finished convictionVotingRemoveVotes.");
    } catch (error) {
        console.error("Error:", error);
        process.exit(1); // Exit with error code
    }
}

main().then(r => process.exit(0));
