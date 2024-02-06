import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Vpc } from "./construct/vpc";
import { Ec2Instance } from "./construct/ec2-instance";
import { Aurora } from "./construct/aurora";

interface AuroraStackProps extends cdk.StackProps {}

export class AuroraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AuroraStackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new Vpc(this, "Vpc");

    // EC2 Instance
    const ec2Instance = new Ec2Instance(this, "Ec2InstanceA", {
      vpc: vpc.vpc,
    });

    // Aurora
    const aurora = new Aurora(this, "Aurora", {
      vpc: vpc.vpc,
    });

    aurora.dbCluster.connections.allowFrom(
      ec2Instance.instance.connections,
      cdk.aws_ec2.Port.tcp(5432)
    );
  }
}
