const _ = require("lodash");
const AWS = require("aws-sdk");
const { Command, flags } = require("@oclif/command");
const { checkVersion } = require("../lib/version-check");
const { track } = require("../lib/analytics");

class SlsRemoveCommand extends Command {
	async run() {
		const { flags } = this.parse(SlsRemoveCommand);
		const { stackName, emptyS3Buckets, region, profile } = flags;

		AWS.config.region = region;
		if (profile) {
			const credentials = new AWS.SharedIniFileCredentials({ profile });
			AWS.config.credentials = credentials;
		}

		checkVersion();
    
		track("sls-remove", { region, emptyS3Buckets });

		this.log(`getting the deployment bucket name for [${stackName}] in [${region}]`);
		const deploymentBucketName = await this.getDeploymentBucketName(stackName);

		if (!deploymentBucketName) {
			throw new Error(
				`Stack [${stackName}] in [${region}] does not have a "ServerlessDeploymentBucketName", are you sure it was deployed with Serverless framework?`
			);
		}

		this.log(`emptying deployment bucket [${deploymentBucketName}]...`);
		await this.emptyBucket(deploymentBucketName);

		if (emptyS3Buckets) {
			this.log("finding other S3 buckets...");
			const bucketNames = (await this.getBucketNames(stackName)).filter(
				x => x !== deploymentBucketName
			);

			if (bucketNames.length > 0) {
				this.log(
					`found ${bucketNames.length} buckets (excluding the deployment bucket)`
				);
				for (const bucketName of bucketNames) {
					this.log(`emptying bucket [${bucketName}]...`);
					await this.emptyBucket(bucketName);
				}
			} else {
				this.log("no other S3 buckets are found besides the deployment bucket");
			}
		}

		this.log(`removing the stack [${stackName}] in [${region}]...`);
		await this.deleteStack(stackName);

		this.log("stack has been deleted!");
	}

	async getDeploymentBucketName(stackName) {
		const CloudFormation = new AWS.CloudFormation();
		const resp = await CloudFormation.describeStacks({
			StackName: stackName
		}).promise();
		const stack = resp.Stacks[0];
		const bucketNameOutput = stack.Outputs.find(
			x => x.OutputKey === "ServerlessDeploymentBucketName"
		);
		return _.get(bucketNameOutput, "OutputValue");
	}

	async getBucketNames(stackName) {
		const CloudFormation = new AWS.CloudFormation();
		const resp = await CloudFormation.describeStackResources({
			StackName: stackName
		}).promise();
		const s3Buckets = resp.StackResources.filter(
			x => x.ResourceType === "AWS::S3::Bucket"
		);
		return s3Buckets.map(x => x.PhysicalResourceId);
	}

	async emptyBucket(bucketName) {
		const S3 = new AWS.S3();
		const listResp = await S3.listObjectsV2({
			Bucket: bucketName
		}).promise();

		const keys = listResp.Contents.map(x => ({ Key: x.Key }));
		await S3.deleteObjects({
			Bucket: bucketName,
			Delete: {
				Objects: keys
			}
		}).promise();
	}

	async deleteStack(stackName) {
		const CloudFormation = new AWS.CloudFormation();
		await CloudFormation.deleteStack({
			StackName: stackName
		}).promise();

		await CloudFormation.waitFor("stackDeleteComplete", {
			StackName: stackName
		}).promise();
	}
}

SlsRemoveCommand.description =
	"Deletes a CloudFormation stack that was generated by the Serverless framework";
SlsRemoveCommand.flags = {
	stackName: flags.string({
		char: "n",
		description: "name of the CloudFormation stack, e.g. hello-world-dev",
		required: true
	}),
	emptyS3Buckets: flags.boolean({
		char: "e",
		description: "empty all S3 buckets that are part of the stack",
		default: false,
		required: false
	}),
	region: flags.string({
		char: "r",
		description: "AWS region, e.g. us-east-1",
		required: true
	}),
	profile: flags.string({
		char: "p",
		description: "AWS CLI profile name",
		required: false
	})
};

module.exports = SlsRemoveCommand;
