import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface AuroraProps {
  vpc: cdk.aws_ec2.IVpc;
}

export class Aurora extends Construct {
  readonly dbCluster: cdk.aws_rds.IDatabaseCluster;

  constructor(scope: Construct, id: string, props: AuroraProps) {
    super(scope, id);

    // DB Cluster Parameter Group
    const dbClusterParameterGroup14 = new cdk.aws_rds.ParameterGroup(
      this,
      "DbClusterParameterGroup14",
      {
        engine: cdk.aws_rds.DatabaseClusterEngine.auroraPostgres({
          version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_14_10,
        }),
        description: "aurora-postgresql14",
        parameters: {
          "rds.logical_replication": "1",
          log_statement: "none",
          "pgaudit.log": "all",
          "pgaudit.role": "rds_pgaudit",
          shared_preload_libraries: "pgaudit",
          ssl_ciphers: "TLS_RSA_WITH_AES_256_GCM_SHA384",
        },
      }
    );

    // DB Parameter Group
    const dbParameterGroup14 = new cdk.aws_rds.ParameterGroup(
      this,
      "DbParameterGroup14",
      {
        engine: cdk.aws_rds.DatabaseClusterEngine.auroraPostgres({
          version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_14_10,
        }),
        description: "aurora-postgresql14",
      }
    );

    // Subnet Group
    const subnetGroup = new cdk.aws_rds.SubnetGroup(this, "SubnetGroup", {
      description: "description",
      vpc: props.vpc,
      subnetGroupName: "SubnetGroup",
      vpcSubnets: props.vpc.selectSubnets({
        onePerAz: true,
        subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
      }),
    });

    // Monitoring Role
    const monitoringRole = new cdk.aws_iam.Role(this, "MonitoringRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal(
        "monitoring.rds.amazonaws.com"
      ),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonRDSEnhancedMonitoringRole"
        ),
      ],
    });

    // DB Cluster
    this.dbCluster = new cdk.aws_rds.DatabaseCluster(this, "Default", {
      engine: cdk.aws_rds.DatabaseClusterEngine.auroraPostgres({
        version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_14_10,
      }),
      writer: cdk.aws_rds.ClusterInstance.provisioned("Writer", {
        instanceType: cdk.aws_ec2.InstanceType.of(
          cdk.aws_ec2.InstanceClass.T3,
          cdk.aws_ec2.InstanceSize.MEDIUM
        ),
        allowMajorVersionUpgrade: false,
        autoMinorVersionUpgrade: true,
        enablePerformanceInsights: true,
        parameterGroup: dbParameterGroup14,
        performanceInsightRetention:
          cdk.aws_rds.PerformanceInsightRetention.DEFAULT,
        publiclyAccessible: false,
        instanceIdentifier: "db-instance-writer",
        caCertificate: cdk.aws_rds.CaCertificate.RDS_CA_RDS4096_G1,
      }),
      backup: {
        retention: cdk.Duration.days(7),
        preferredWindow: "16:00-16:30",
      },
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_YEAR,
      clusterIdentifier: "db-cluster",
      copyTagsToSnapshot: true,
      defaultDatabaseName: "testDB",
      deletionProtection: false,
      iamAuthentication: false,
      monitoringInterval: cdk.Duration.minutes(1),
      monitoringRole,
      parameterGroup: dbClusterParameterGroup14,
      preferredMaintenanceWindow: "Sat:17:00-Sat:17:30",
      storageEncrypted: true,
      storageEncryptionKey: cdk.aws_kms.Alias.fromAliasName(
        this,
        "DefaultRdsKey",
        "alias/aws/rds"
      ),
      vpc: props.vpc,
      subnetGroup,
    });

    // DB Instance PreferredMaintenanceWindow
    const shiftTime = (dayTime: string, shiftMinutes: number) => {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      const day = dayTime.substring(0, 3);
      const time = dayTime.substring(4);

      const [hour, min] = time.split(":").map(Number);

      const totalMinutes = hour * 60 + min + shiftMinutes;
      const targetHour = Math.floor(totalMinutes / 60) % 24;
      const targetMinutes = totalMinutes % 60;
      const shiftedDays = Math.floor(totalMinutes / (24 * 60));

      const dayIndex = days.indexOf(day);
      const targetDay = days[(dayIndex + shiftedDays) % days.length];

      return [
        `${targetDay}:${targetHour.toString().padStart(2, "0")}:${targetMinutes
          .toString()
          .padStart(2, "0")}`,
      ];
    };

    const generateShiftMaintenanceWindows = (
      baseMaintenanceWindow: string,
      shiftMinutes: number,
      shiftCount: number
    ) => {
      const [baseStartDayTime, baseEndDayTime] =
        baseMaintenanceWindow.split("-");

      return [...Array(shiftCount)].map((_, i) => {
        const startDayTime = shiftTime(
          baseStartDayTime,
          shiftMinutes * (i + 1)
        );
        const endDayTime = shiftTime(baseEndDayTime, shiftMinutes * (i + 1));
        return `${startDayTime}-${endDayTime}`;
      });
    };

    const cfnDbInstances = this.dbCluster.node.children
      .filter(
        (child) => child.node.defaultChild instanceof cdk.aws_rds.CfnDBInstance
      )
      .map((child) => child.node.defaultChild) as cdk.aws_rds.CfnDBInstance[];

    const dbInstanceMaintenanceWindows = generateShiftMaintenanceWindows(
      "Sat:17:00-Sat:17:30",
      30,
      cfnDbInstances.length
    ).reverse();

    cfnDbInstances.forEach((cfnDbInstance, i) => {
      cfnDbInstance.addPropertyOverride(
        "PreferredMaintenanceWindow",
        dbInstanceMaintenanceWindows[i]
      );
    });
  }
}
