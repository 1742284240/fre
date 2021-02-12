import { IFiber, FreElement, FC, Attributes, HTMLElementEx, FreNode, IRef, IEffect } from './type'
import { createElement, updateElement } from './dom'
import { resetCursor } from './hooks'
import { scheduleWork, shouldYield, schedule, getTime } from './scheduler'
import { isArr, createText } from './h'

let currentFiber: IFiber
let commitment = null

export const enum OP {
  UPDATE = 1 << 1,
  INSERT = 1 << 2,
  REMOVE = 1 << 3,
  FRAGMENT = 1 << 4,
  SIBLING = 1 << 5,
  SVG = 1 << 6,
  MOUNT = UPDATE | INSERT,
}
export const render = (vnode: FreElement, node: Node, done?: () => void): void => {
  const rootFiber = {
    node,
    props: { children: vnode },
    done,
  } as IFiber
  dispatchUpdate(rootFiber)
}

export const dispatchUpdate = (fiber?: IFiber) => {
  if (fiber && !fiber.dirty) {
    fiber.dirty = true
    fiber.tag = OP.UPDATE
    commitment = fiber
    scheduleWork(reconcileWork.bind(null, fiber), fiber.time)
  }
}

const reconcileWork = (WIP?: IFiber): boolean => {
  while (WIP && !shouldYield()) WIP = reconcile(WIP)
  if (WIP) return reconcileWork.bind(null, WIP)
  if (commitment.last) commitWork(commitment.last)
  return null
}

const reconcile = (WIP: IFiber): IFiber | undefined => {
  isFn(WIP.type) ? updateHook(WIP) : updateHost(WIP)
  WIP.dirty = WIP.dirty ? false : 0

  if (WIP.child) return WIP.child
  while (WIP) {
    if (!commitment.last && WIP.dirty === false) {
      commitment.last = WIP
      WIP.sibling = null
      return null
    }
    if (WIP.sibling) return WIP.sibling
    WIP = WIP.parent
  }
}

const updateHook = <P = Attributes>(WIP: IFiber): void => {
  if (WIP.lastProps === WIP.props) return
  currentFiber = WIP
  resetCursor()
  let start = getTime()
  let children = (WIP.type as FC<P>)(WIP.props)
  WIP.time = getTime() - start
  if (isStr(children)) children = createText(children as string)
  if (isArr(children)) WIP.tag |= OP.FRAGMENT
  reconcileChildren(WIP, children)
}

const getParentNode = (WIP: IFiber): HTMLElement | undefined => {
  while ((WIP = WIP.parent)) {
    if (!isFn(WIP.type)) return WIP.node
  }
}

const updateHost = (WIP: IFiber): void => {
  WIP.parentNode = getParentNode(WIP) as any
  if (!WIP.node) {
    if (WIP.type === 'svg') WIP.tag |= OP.SVG
    WIP.node = createElement(WIP) as HTMLElementEx
  }
  reconcileChildren(WIP, WIP.props.children)
}

const reconcileChildren = (WIP: any, children: FreNode): void => {
  let aCh = WIP.kids || [],
    bCh = (WIP.kids = arrayfy(children) as any),
    aHead = 0,
    bHead = 0,
    aTail = aCh.length - 1,
    bTail = bCh.length - 1,
    map = null,
    ch = Array(bCh.length)

  while (aHead <= aTail && bHead <= bTail) {
    let temp = null
    if (aCh[aHead] == null) {
      aHead++
    } else if (aCh[aTail] == null) {
      aTail--
    } else if (same(aCh[aHead], bCh[bHead])) {
      temp = bCh[bHead]
      clone(temp, aCh[aHead])
      temp.tag = OP.UPDATE
      ch[bHead] = temp
      aHead++
      bHead++
    } else if (same(aCh[aTail], bCh[bTail])) {
      temp = bCh[bTail]
      clone(temp, aCh[aTail])
      temp.tag = OP.UPDATE
      ch[bTail] = temp
      aTail--
      bTail--
    } else if (same(aCh[aHead], bCh[bTail])) {
      temp = bCh[bTail]
      clone(temp, aCh[aHead])
      temp.tag = OP.MOUNT | OP.SIBLING
      temp.after = aCh[aTail]
      ch[bTail] = temp
      aHead++
      bTail--
    } else if (same(aCh[aTail], bCh[bHead])) {
      temp = bCh[bHead]
      clone(temp, aCh[aTail])
      temp.tag = OP.MOUNT
      temp.after = aCh[aHead]
      ch[bHead] = temp
      aTail--
      bHead++
    } else {
      if (!map) {
        map = new Map()
        let i = aHead
        while (i < aTail) map.set(getKey(aCh[i]), i++)
      }
      const key = getKey(bCh[bHead])
      if (map.has(key)) {
        const oldKid = aCh[map.get(key)]
        temp = bCh[bHead]
        clone(temp, oldKid)
        temp.tag = OP.MOUNT
        temp.after = aCh[aHead]
        ch[bHead] = temp
        aCh[map.get(key)] = null
      } else {
        temp = bCh[bHead]
        temp.tag = OP.INSERT
        temp.node = null
        temp.after = aCh[aHead]
      }
      bHead++
    }
    commitment.next = temp
    commitment = temp
  }
  const after = ch[bTail + 1]
  while (bHead <= bTail) {
    let temp = bCh[bHead]
    temp.tag = OP.INSERT
    temp.after = after
    temp.node = null
    commitment.next = temp
    commitment = temp
    bHead++
  }
  while (aHead <= aTail) {
    let oldFiber = aCh[aHead]
    if (oldFiber) {
      oldFiber.tag = OP.REMOVE
      commitment.next = oldFiber
      commitment = oldFiber
    }
    aHead++
  }
  for (var i = 0, prev = null; i < bCh.length; i++) {
    const child = bCh[i]
    child.parent = WIP
    if (i > 0) {
      prev.sibling = child
    } else {
      if (WIP.tag & OP.SVG) child.tag |= OP.SVG
      WIP.child = child
    }
    prev = child
  }
}

function clone(a, b) {
  a.lastProps = b.props
  a.node = b.node
  a.kids = b.kids
  a.hooks = b.hooks
  a.ref = b.ref
}

const getKey = (vdom) => (vdom == null ? vdom : vdom.key)
const getType = (vdom) => (isFn(vdom.type) ? vdom.type.name : vdom.type)

const commitWork = (commitment: IFiber): void => {
  let fiber = commitment
  while (fiber) {
    if (fiber.tag & OP.FRAGMENT) {
      fiber.kids.forEach(kid => {
        kid.tag |= fiber.tag
        kid.after = fiber.after
        commit(kid)
        kid.tag = 0
      })
    } else if (fiber.tag) {
      commit(fiber)
      fiber.tag = 0
    }
    fiber = fiber.next
  }
  commitment.done?.()
}

const getChild = (WIP: IFiber): any => {
  let fiber = WIP
  while ((WIP = WIP.child)) {
    if (!isFn(WIP.type)) {
      WIP.tag |= fiber.tag
      WIP.after = fiber.after
      return WIP
    }
  }
}

const commit = (fiber: IFiber): void => {
  let { type, tag, parentNode, node, ref, hooks, after } = fiber
  if (isFn(type)) {
    const child = getChild(fiber)
    if (fiber.tag & OP.REMOVE) {
      commit(child)
      hooks && hooks.list.forEach(cleanup)
    } else if (hooks) {
      side(hooks.layout)
      schedule(() => side(hooks.effect))
    }
    return
  }
  if (tag & OP.REMOVE) {
    kidsRefer(fiber.kids)
    parentNode.removeChild(fiber.node)
    refer(ref, null)
    return
  }
  if (tag & OP.UPDATE) {
    updateElement(node, fiber.lastProps || {}, fiber.props)
  }
  if (tag & OP.INSERT) {
    if (tag & OP.FRAGMENT) {
      after = tag & OP.SIBLING ? after?.kids[after?.kids.length - 1].nextSibling : after?.child.node
    } else {
      after = tag & OP.SIBLING ? after?.node?.nextSibling : after?.node
    }
    parentNode.insertBefore(node, after)
  }
  refer(ref, node)
}

const same = (a, b) => {
  return getKey(a) === getKey(b) && getType(a) === getType(b)
}

const arrayfy = (arr) => (!arr ? [] : isArr(arr) ? arr : [arr])

const refer = (ref: IRef, dom?: HTMLElement): void => {
  if (ref) isFn(ref) ? ref(dom) : ((ref as { current?: HTMLElement })!.current = dom)
}

const kidsRefer = (kids: any): void => {
  kids.forEach((kid) => {
    kid.kids && kidsRefer(kid.kids)
    refer(kid.ref, null)
  })
}

const side = (effects: IEffect[]): void => {
  effects.forEach(cleanup)
  effects.forEach(effect)
  effects.length = 0
}

export const getCurrentFiber = () => currentFiber || null

const effect = (e: IEffect): void => (e[2] = e[0]())
const cleanup = (e: IEffect): void => e[2] && e[2]()
export const isFn = (x: any): x is Function => typeof x === 'function'
export const isStr = (s: any): s is number | string => typeof s === 'number' || typeof s === 'string'
export const some = (v: any) => v != null && v !== false && v !== true
