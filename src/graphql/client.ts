import { GraphQLClient } from "graphql-request";
import { config } from "../config.js";

export const graphqlClient = new GraphQLClient(`${config.magento.baseUrl}/graphql`);
