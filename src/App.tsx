/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react'
import { ethers } from 'ethers'
import * as bech32 from "bech32";
import { useSignTypedData, useSignMessage } from 'wagmi'
// import { constructEIP712Tx } from 'carbon-js-sdk/lib/util/eip712'
import { makeSignDoc } from "@cosmjs/amino/build";
import { Buffer } from 'buffer/'
import { DEFAULT_CARBON_DOMAIN_FIELDS, DEFAULT_EIP712_TYPES } from "carbon-js-sdk/lib/constant/eip712";
import { TypedDataDomain, TypedDataField } from "@ethersproject/abstract-signer";
// import { TypeUtils } from ".";
import { parseChainId } from "carbon-js-sdk/lib/util/ethermint";
import { EIP712Types } from "carbon-js-sdk/lib/codec";
import { AminoTypes } from "@cosmjs/stargate";
// import AminoTypesMap from "carbon-js-sdk/lib/provider/amino/AminoTypesMap";
import { capitalize } from "lodash";
import { CarbonTx } from "carbon-js-sdk/lib/util";
import { AminoMsg } from "@cosmjs/amino/build";


import { Network } from "carbon-js-sdk/lib/constant";
import Long from "long";
import './App.css'

console.log(AminoTypes)
const message = 'hello world'

function getPublicKey(signedMessage: string) {
  const uncompressedPublicKey = ethers.utils.recoverPublicKey(ethers.utils.hashMessage(message), signedMessage)
  return ethers.utils.computePublicKey(uncompressedPublicKey, true).split('0x')[1]

}

function stringOrBufferToBuffer (
  stringOrBuffer?: string | Buffer,
  encoding: BufferEncoding = "hex",
  force: boolean = false
): Buffer | null {
  if (typeof stringOrBuffer === "string") {
    return Buffer.from(stringOrBuffer, encoding);
  }

  if (stringOrBuffer instanceof Buffer) {
    return stringOrBuffer as Buffer;
  }

  // not a string nor buffer
  // e.g. null/undefined
  if (force) {
    return Buffer.alloc(0);
  }

  // if not forcing to return an empty buffer, return null
  return null;
}

const stripHexPrefix = (input: string) => {
  return input?.slice(0, 2) === "0x" ? input.slice(2) : input;
}


function pubKeyToAddress(pubKey: string): string {
  const pubKeyBuffer = stringOrBufferToBuffer(pubKey)!;
  const sha256Hash = ethers.utils.sha256(pubKeyBuffer);
  const ripemdHash = ethers.utils.ripemd160(sha256Hash);

  const scriptHash = stripHexPrefix(ripemdHash);

  const hashBuff = stringOrBufferToBuffer(scriptHash, "hex")!;
  const words = bech32.toWords(hashBuff.slice(0, 20));
  const addressPrefix = 'swth'
  const address = bech32.encode(addressPrefix, words);
  return address

}




export interface SimpleMap<T = unknown> {
  [index: string]: T;
}

export interface NetworkMap<T> {
  [Network.MainNet]: T;
  [Network.TestNet]: T;
  [Network.DevNet]: T;
  [Network.LocalHost]: T;
}

export type OptionalNetworkMap<T> = Partial<NetworkMap<T>>;

/**
 * converts snakecase strings to camelcase
 * @param snakeStr string to convert to camelcase
 */
export const snakeToCamel = (snakeStr: string): string => {
  if (!snakeStr.includes("_")) {
    return snakeStr;
  }
  const camelArr = snakeStr.split("_").map((snakeItem: string, index: number) => {
    if (index === 0) {
      return snakeItem;
    }
    return snakeItem.length > 1 ? `${snakeItem[0].toUpperCase()}${snakeItem.substr(1)}` : snakeItem.toUpperCase();
  });
  return camelArr.join("");
};

/**
 * converts snakecase strings to camelcase
 * @param camelStr string to convert to camelcase
 */
export const camelToSnake = (camelStr: string): string => {
  if (camelStr.length <= 1) {
    return camelStr;
  }
  let newSnake: string = "";
  for (const letter of camelStr) {
    const newLetter = letter !== letter.toLowerCase() ? `_${letter.toLowerCase()}` : letter;
    newSnake = `${newSnake}${newLetter}`;
  }
  return newSnake;
};

export const isDurationType = (value: any): boolean => {
  return Long.isLong(value?.seconds) && typeof value?.nanos === "number";
};



export interface EIP712Tx {
    readonly types: SimpleMap<TypedDataField[]>;
    readonly primaryType: string;
    readonly domain: TypedDataDomain;
    readonly message: any;
}

function getTypes(msgs: readonly AminoMsg[]): SimpleMap<TypedDataField[]> {
    let types: SimpleMap<TypedDataField[]> = { ...DEFAULT_EIP712_TYPES }
    const includedTypes: string[] = []
    let valueIndex = 0
    msgs.forEach((msg: AminoMsg, index: number) => {

        // @dev typeUrl IS HARDCODED for now as I am unable to fix AminoTypesMap
        // const typeUrl = AminoTypesMap.fromAmino(msg).typeUrl
        const typeUrl = '/Switcheo.carbon.order.MsgCreateOrder'
        
        const msgType = msg.type.split('/')[1]
        const msgTypeIndex = getLatestMsgTypeIndex(`Type${msgType}`, types)
        //cosmos-sdk/MsgSend => TypeMsgSend1
        const typeKey = `Type${msgType}${msgTypeIndex}`
        if (!includedTypes.includes(msg.type)) {
            types['Tx'] = [...types['Tx'], { name: `msg${index}`, type: typeKey }]
            types[typeKey] = [{ name: 'value', type: `TypeValue${valueIndex}` }, { name: 'type', type: 'string' }]
            //cosmos-sdk/MsgSend => Msg_Send
            types = { ...types, ...sortByNameDescending(getMsgValueType(typeUrl, msg.value, `TypeValue${valueIndex}`, valueIndex, types)) }
            includedTypes.push(msg.type)
            valueIndex++
            return
        }
        const typeFound = matchingType(msg, types)
        if (typeFound) {
            types['Tx'] = [...types['Tx'], { name: `msg${index}`, type: typeFound }]
            return
        }
        //same type, but different fields populated, so new type defnition is required
        types['Tx'] = [...types['Tx'], { name: `msg${index}`, type: typeKey }]
        types[typeKey] = [{ name: 'value', type: `TypeValue${valueIndex}` }, { name: 'type', type: 'string' }]
        types = { ...types, ...sortByNameDescending(getMsgValueType(typeUrl, msg.value, `TypeValue${valueIndex}`, valueIndex, types)) }
        valueIndex++

    })
    console.log('types', types)
    return types
}

function getLatestMsgTypeIndex(typeName: string, types: SimpleMap<TypedDataField[]>): number {
    let index = 0;
    Object.entries(types).forEach(([key, _]) => { // eslint-disable-line

        if (key.includes(typeName)) {
            index++

        }
    });

    return index
}
function sortByNameDescending(types: SimpleMap<TypedDataField[]>): SimpleMap<TypedDataField[]> {
    Object.entries(types).forEach(([key, _]) => { // eslint-disable-line
        types[key].sort((a, b) => b.name.localeCompare(a.name));
    });
    return types

}

// Checks if there is a need to create new type for the same message type because of different populated fields 
function matchingType(msg: AminoMsg, eipTypes: SimpleMap<TypedDataField[]>): string {
    const msgType = msg.type.split('/')[1]
    let match = false

    for (const key in eipTypes) {
        if (key.includes(msgType)) {
            match = compareValues(msg, key, eipTypes)
        }
        if (match) {
            return key
        }
    }
    return ''



}

function compareValues(msg: any, key: string, eipTypes: SimpleMap<TypedDataField[]>): boolean {
    let match = true
    for (let { name, type } of eipTypes[key]) { // eslint-disable-line
        if (Object.keys(msg).length > eipTypes[key].length) {
            return false
        }
        let value = msg[name]
        if (!isNonZeroField(value)) {
            return false
        }
        const typeIsArray = type.includes('[]')
        if (typeIsArray) {
            type = type.split('[]')[0]
            //Assumption: Take first value in array to determine which fields are populated
            value = value[0]
        }
        if (eipTypes[type]) {
            match = compareValues(value, type, eipTypes)
        }
    }
    return match
}

function getMsgValueType(msgTypeUrl: string, msgValue: any, msgTypeName: string, msgTypeIndex: number, types: SimpleMap<TypedDataField[]>, objectName?: string, nestedType: boolean = false, msgTypeDefinitions: SimpleMap<TypedDataField[]> = {}): SimpleMap<TypedDataField[]> {
    const packageName = msgTypeUrl.split(".").slice(0, -1).join(".")
    const msgFieldType = msgTypeUrl.split(".").pop()!
    const typeName = getTypeName(msgTypeName, msgTypeIndex, objectName, nestedType, false)
    const fieldsDefinition = EIP712Types[packageName][msgFieldType]
    if (isNonZeroField(msgValue)) {
        if (!msgTypeDefinitions[typeName]) {
            msgTypeDefinitions[typeName] = [];
        }
        fieldsDefinition.forEach(({ packageName, name, type }: any) => {
            const fieldValue = Array.isArray(msgValue) && msgValue.length > 0 ? msgValue[0][name] : msgValue[name]
            //Assumption: Take first value in array to determine which fields are populated
            if (isNonZeroField(fieldValue)) {
                if (Array.isArray(fieldValue) && fieldValue.length === 0) {
                    msgTypeDefinitions[typeName] = [...msgTypeDefinitions[typeName], { name, type: 'string[]' }]
                    return
                }
                //For nested structs
                if (packageName) {
                    const isArray = type.includes('[]') ? true : false
                    // TypeValue0 --> Value
                    const objectName = typeName.split('Type')[1].split(/\d+/)[0]
                    const nestedTypeName = `Type${objectName ? objectName : ''}${name.split('_').map((subName: string) => capitalize(subName)).join('')}`
                    const nestedMsgTypeIndex = getLatestMsgTypeIndex(nestedTypeName, types)
                    const nestedType = getTypeName(name, nestedMsgTypeIndex, objectName, true, isArray)
                    msgTypeDefinitions[typeName] = [...msgTypeDefinitions[typeName], { name, type: nestedType }]
                    //Special logic if nested struct is google protobuf's Any type
                    if (isGoogleProtobufAnyPackage(packageName, type)) {
                        const nestedAnyTypeName = isArray ? nestedType.split('[]')[0].split(/\d+/)[0] : nestedType.split(/\d+/)[0]
                        const nestedMsgTypeIndex = getLatestMsgTypeIndex(`${nestedAnyTypeName}Value`, types)
                        const nestedAnyValueType = `${nestedAnyTypeName}Value${nestedMsgTypeIndex}`
                        msgTypeDefinitions[`${nestedAnyTypeName}${nestedMsgTypeIndex}`] = [{ name: "type", type: "string" }, { name: "value", type: nestedAnyValueType }]
                        const anyObjectTypeNameSplit = nestedAnyTypeName.split('Type')[1].split(/\d+/)[0]
                        const messageTypeUrl = '/google.protobuf.Any'
                        getMsgValueType(messageTypeUrl, fieldValue.value, "value", nestedMsgTypeIndex, types, anyObjectTypeNameSplit, true, msgTypeDefinitions)
                    }
                    else {
                        const typeStructName = type.includes('[]') ? type.split('[]')[0].split(/\d+/)[0] : type.split(/\d+/)[0]
                        const messageTypeUrl = `${packageName}.${typeStructName}`
                        getMsgValueType(messageTypeUrl, fieldValue, name, nestedMsgTypeIndex, types, objectName, true, msgTypeDefinitions)

                    }
                }
                else {
                    msgTypeDefinitions[typeName] = [...msgTypeDefinitions[typeName], { name, type: getGjsonPrimitiveType(fieldValue) }]
                }
            }
        })
    }
    return msgTypeDefinitions
}

function getGjsonPrimitiveType(value: any) {
    if (typeof value === 'number') {
        return 'int64'
    }
    if (typeof value === 'boolean') {
        return 'bool'
    }
    if (Array.isArray(value) && value.length && value.every(item => typeof item === 'string')) {
        return 'string[]'
    }
    return 'string'
}

function getTypeName(name: string, index: number, objectName?: string, nestedType: boolean = false, isArray: boolean = false) {
    if (nestedType) {
        return `Type${objectName ? objectName : ''}${name.split('_').map(subName => capitalize(subName)).join('')}${index}${isArray ? '[]' : ''}`
    }
    return name
}

function isGoogleProtobufAnyPackage(packageName: string, type: string): boolean {
    return packageName === '/google.protobuf' && type == 'Any'
}

function isNonZeroField(fieldValue: any): boolean {
    // zero fields are considered falsey,except if it is string "0"
    if (fieldValue == "0" && typeof fieldValue !== "string") {
        return false
    }
    // empty arrays are considered truthy
    if (Array.isArray(fieldValue)) {
        return true
    }
    // empty objects are considered truthy
    if (fieldValue && typeof fieldValue === 'object' && Object.keys(fieldValue).length === 0) {
        return true
    }
    return fieldValue
}

export function constructEIP712Tx(doc: CarbonTx.StdSignDoc): EIP712Tx {
    const { account_number, chain_id, fee, memo, sequence } = doc
    const eip712Tx = {
        types: getTypes(doc.msgs),
        primaryType: "Tx",
        domain: { ...DEFAULT_CARBON_DOMAIN_FIELDS, chainId: parseChainId(doc.chain_id) },
        message: { account_number, chain_id, fee, memo, sequence, ...convertMsgs(doc.msgs) },
    }

    return eip712Tx
}

function convertMsgs(msgs: readonly AminoMsg[]): any {
    const convertedMsgs: any = {}
    msgs.forEach((msg, index) => {
        convertedMsgs[`msg${index}`] = msg
    })
    return convertedMsgs
}



const orderMessage = {
  "account_number": "60871",
  "chain_id": "carbon_9790-1",
  "fee": {
      "amount": [
          {
              "amount": "0",
              "denom": "cgt/1"
          }
      ],
      "gas": "10000000"
  },
  "memo": "dmx-c-p",
  "sequence": "1",
  "msg0": {
      "type": "order/CreateOrder",
      "value": {
          "creator": "swth1f6akes0pcjtfdha599cruq2e37ugkrpfvjnqjl",
          "market_id": "cmkt/117",
          "side": "buy",
          "quantity": "24000000000000000",
          "order_type": "limit",
          "price": "3234700000000000000000",
          "time_in_force": "gtc"
      }
  }
}

function App() {
  const { signTypedData } = useSignTypedData()
  const s = useSignMessage()
  // const [address, setAddress] = useState<string>('')
  const accountInfo = useMemo(() => {
    if (s.data) {
      const pubKey = getPublicKey(s.data)
      // console.log('pubkey', pubKey)
      // const address = pubKeyToAddress(pubKey)
      return { pubKey, swth: pubKeyToAddress(pubKey)} 
      // console.log('address', address)
  
    }
    return {
      pubKey: '',
      swth: '',
    }
    
  }, [s.data])


  const msgs = [{
    type: 'order/CreateOrder',
    // type: '/Switcheo.carbon.order.MsgCreateOrder',
    value: {
      creator: 'swth1f6akes0pcjtfdha599cruq2e37ugkrpfvjnqjl',
      market_id: 'cmkt/117',
      side: 'buy',
      quantity: '24000000000000000',
      order_type: 'limit',
      price: '3234700000000000000000',
      time_in_force: 'gtc'
    }
  }]
  const fee = {
    amount: [{ amount: '0', denom: 'cgt/1' }],
    gas: '10000000'
  }
  const evmChainId = 'carbon_9790-1'
  const memo = ''
  const accountNumber = '60871'
  const sequence = '1'
  const stdSignDoc = makeSignDoc(msgs, fee, evmChainId, memo, accountNumber, sequence)
  console.log('stdSignDoc', stdSignDoc)
  const eip712Tx = constructEIP712Tx(stdSignDoc)
  console.log('eip712Tx', eip712Tx)

  return (
    <>
      <h1>Vite + React</h1>
      <div className="flex">
          <w3m-button />
          <button onClick={() => s.signMessage({ message })}>
            Sign and get SWTH address
          </button>
        <b>pubkey: {accountInfo.pubKey}</b>
        <b>add: {accountInfo.swth}</b>
      </div>
        <button
      onClick={() =>
        signTypedData(eip712Tx)
      }
    >
      Sign message
    </button>
    </>
  )
}

export default App
